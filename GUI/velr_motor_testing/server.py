#!/usr/bin/env python3
"""
Static Fire Test - WebSocket Server with Telnet Support
Updated for new protocol - CORRECTED MERGED VERSION
"""

import asyncio
import json
import logging
import socket
import sys  
import telnetlib
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
import csv

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# ==================== CONFIGURATION ====================

# ESP Telnet Configuration (UPDATED from second code)
ESP_HOST = "192.168.137.68"  # ESP's IP - UPDATED
ESP_PORT = 2323               # Standard Telnet port
TELNET_TIMEOUT = 5.0        # Connection timeout in seconds
RECONNECT_DELAY = 3.0       # Seconds to wait before reconnecting

# WebSocket Configuration
WS_HOST = "0.0.0.0"
WS_PORT = 8000

# Telemetry Settings
MAX_LINE_LENGTH = 1024
EXPECTED_TEMP_SENSORS = 11  # Updated to 11 temperature sensors

# Enable debug logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== DATA MODELS ====================

class SystemStatus(str, Enum):
    WORKING = "WORKING"
    ERROR = "ERROR"

class MotorState(str, Enum):
    IDLE = "IDLE"
    ARMED = "ARMED"
    FIRING = "FIRING"
    ABORT = "ABORT"
    SAFE = "SAFE"

class SystemState(int, Enum):
    SYSTEM_SAFE = 0
    SYSTEM_IDLE = 1
    SYSTEM_ARMED = 2
    SYSTEM_IGNITION = 3
    SYSTEM_POST_IGNITION = 4

class TemperatureSensor:
    def __init__(self, value: Optional[float], status: str):
        self.value = value
        self.status = status.upper()
    
    def to_dict(self):
        return {"value": self.value, "status": self.status}

class TelemetryFrame:
    def __init__(self):
        self.timestamp = datetime.now().timestamp()
        # time reported by controller (we'll parse microseconds into both us and ms)
        self.time_us: Optional[int] = None
        self.time_ms = 0.0
        self.thrust = 0.0
        self.chamberPressure = 0.0
        self.temperatures = []
        self.continuityVoltages = [0.0, 0.0]
        self.systemStatus = SystemStatus.WORKING
        self.status = MotorState.IDLE
        self.systemState = SystemState.SYSTEM_SAFE  # New system state

    def to_dict(self):
        return {
            "timestamp": self.timestamp,
            "timeUs": self.time_us,
            "timeMs": self.time_ms,
            "thrust": self.thrust,
            "chamberPressure": self.chamberPressure,
            "temperatures": [t.to_dict() for t in self.temperatures],
            "continuityVoltages": self.continuityVoltages,
            "systemStatus": self.systemStatus.value,
            "status": self.status.value,
            "systemState": self.systemState.name  # Send as string
        }

# ==================== TELNET CLIENT ====================

class TelnetClient:
    """Manages Telnet connection to ESP"""
    
    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        self.tn = None
        self.is_connected = False
        self._running = False
        self._io_lock = asyncio.Lock()
        self._response_queue: asyncio.Queue[str] = asyncio.Queue()

    @staticmethod
    def _is_command_response(line: str) -> bool:
        upper = line.strip().upper()
        return upper == "ACK" or upper.startswith("ERR") or upper.startswith("ERROR") or upper.startswith("FAULT")
        
    async def connect(self) -> bool:
        """Establish Telnet connection to ESP"""
        try:
            logger.info(f"Connecting to Telnet at {self.host}:{self.port}...")
            
            loop = asyncio.get_event_loop()
            self.tn = await loop.run_in_executor(
                None, 
                lambda: telnetlib.Telnet(self.host, self.port, TELNET_TIMEOUT)
            )
            
            self.is_connected = True
            logger.info(f"Connected to ESP at {self.host}:{self.port}")
            return True
            
        except (socket.timeout, ConnectionRefusedError, OSError) as e:
            logger.error(f"Telnet connection failed: {e}")
            self.is_connected = False
            return False
        except Exception as e:
            logger.error(f"Unexpected connection error: {e}")
            self.is_connected = False
            return False
    
    async def send_command(self, command: str) -> str:
        """Send command to ESP over Telnet and wait for response"""
        if not self.is_connected or not self.tn:
            logger.warning("Cannot send command: Not connected")
            return "ERROR:NOT_CONNECTED"
    
        try:
            # Drop any stale responses before sending a new command
            while not self._response_queue.empty():
                try:
                    self._response_queue.get_nowait()
                except Exception:
                    break

            # Serialize low-level socket writes
            async with self._io_lock:
                cmd_bytes = f"{command}\n".encode('ascii')
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None,
                    lambda: self.tn.write(cmd_bytes)
                )
                logger.info(f"Sent command: {command}")

            try:
                response = await asyncio.wait_for(self._response_queue.get(), timeout=3.0)
                upper = response.upper()
                if upper == "ACK":
                    logger.info(f"Received ACK for {command}")
                    return "ACK"

                logger.error(f"Received ERROR for {command}: {response}")
                return response
            except asyncio.TimeoutError:
                logger.warning(f"No ACK received for {command} within timeout")
                return "ERROR:TIMEOUT"
                
        except Exception as e:
            logger.error(f"Failed to send command '{command}': {e}")
            return f"ERROR:{str(e)}"
    
    async def read_line(self) -> Optional[str]:
        """Read a line from Telnet connection"""
        if not self.is_connected or not self.tn:
            return None
        
        try:
            loop = asyncio.get_event_loop()
            async with self._io_lock:
                line_bytes = await loop.run_in_executor(
                    None,
                    lambda: self.tn.read_until(b'\n', timeout=1)
                )
            
            if line_bytes:
                line = line_bytes.decode('utf-8', errors='ignore').strip()
                if line and not line.startswith(b'\xff'.decode('latin-1')):
                    return line
                    
        except (EOFError, ConnectionResetError, BrokenPipeError):
            logger.warning("Telnet connection lost")
            self.is_connected = False
        except socket.timeout:
            pass
        except Exception as e:
            logger.error(f"Telnet read error: {e}")
            self.is_connected = False
        
        return None
    
    async def start_reading(self, callback) -> None:
        """Start continuous reading from Telnet"""
        self._running = True
        
        while self._running:
            if not self.is_connected:
                logger.info(f"Attempting to reconnect in {RECONNECT_DELAY} seconds...")
                await asyncio.sleep(RECONNECT_DELAY)
                
                if not await self.connect():
                    continue
            
            try:
                line = await self.read_line()
                if line:
                    if self._is_command_response(line):
                        self._response_queue.put_nowait(line)
                    else:
                        await callback(line)
                else:
                    await asyncio.sleep(0.01)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in read loop: {e}")
                self.is_connected = False
                await asyncio.sleep(1)
    
    async def stop(self):
        """Stop the Telnet client"""
        self._running = False
        if self.tn:
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self.tn.close)
            except:
                pass
            finally:
                self.tn = None
                self.is_connected = False
        
        logger.info("Telnet client stopped")

# ==================== PARSING LOGIC ====================

def parse_telemetry_string(raw_string: str) -> Optional[TelemetryFrame]:
    """Parse new telemetry string format from ESP"""
    try:
        frame = TelemetryFrame()
        raw_string = raw_string.strip()
        
        if not raw_string:
            return None
        
        # Split comma-separated values
        values = raw_string.split(',')
        
        # We need at least time, thrust, pressure (3 values) for basic telemetry
        if len(values) < 3:
            return None
        
        # For full telemetry, we need time, thrust, pressure, 11 temps, state (15 values)
        # But accept 14 values for backward compatibility
        if len(values) < 14:
            logger.warning(f"Insufficient values in telemetry string: {len(values)}")
            return None
        
        # Parse values in order
        try:
            # 1. timestamp: microseconds since boot (field 0)
            try:
                us = int(float(values[0]))
            except Exception:
                us = int(float(values[0]) if values[0] else 0)
            frame.time_us = us
            frame.time_ms = us / 1000.0

            # 2. thrust (N)
            frame.thrust = float(values[1])

            # 3. pressure (integer raw value)
            try:
                frame.chamberPressure = int(float(values[2]))
            except Exception:
                frame.chamberPressure = 0
            
            # 4. Temperature sensors (11 sensors) - positions 3 through 13
            # 4. Temperature sensors mapping:
            # T1-T6: MAX31855 thermocouples (may be float or exact fault strings)
            # T7-T10: Analog temps (float)
            # T11: Board internal temp (float)
            faults = {"OPEN", "SHORT GND", "SHORT VCC", "ERROR", "NAN", ""}
            for i in range(11):
                idx = 3 + i
                if idx < len(values):
                    temp_str = values[idx].strip()
                    # Thermocouples
                    if i < 6:
                        if temp_str.upper() in faults:
                            # Preserve the exact fault string in status
                            frame.temperatures.append(TemperatureSensor(None, temp_str.upper() if temp_str else "OPEN"))
                        else:
                            try:
                                temp_value = float(temp_str)
                                frame.temperatures.append(TemperatureSensor(temp_value, "WORKING"))
                            except Exception:
                                frame.temperatures.append(TemperatureSensor(None, "ERROR"))
                    else:
                        # Analog sensors and board temp: expect floats
                        try:
                            temp_value = float(temp_str)
                            frame.temperatures.append(TemperatureSensor(temp_value, "WORKING"))
                        except Exception:
                            frame.temperatures.append(TemperatureSensor(None, "ERROR"))
                else:
                    frame.temperatures.append(TemperatureSensor(None, "ERROR"))
            
            # 5. System state (0-4) - position 14 if available
            if len(values) > 14:
                try:
                    system_state_value = int(float(values[14]))
                    if 0 <= system_state_value <= 4:
                        frame.systemState = SystemState(system_state_value)
                    else:
                        frame.systemState = SystemState.SYSTEM_SAFE
                except ValueError:
                    frame.systemState = SystemState.SYSTEM_SAFE
            else:
                # If state not in telemetry, infer from previous logic
                frame.systemState = SystemState.SYSTEM_SAFE
            
            # Continuity voltages (not in string)
            frame.continuityVoltages = [0.0, 0.0]
            
            # Update motor state based on system state
            if frame.systemState == SystemState.SYSTEM_ARMED:
                frame.status = MotorState.ARMED
            elif frame.systemState == SystemState.SYSTEM_IGNITION:
                frame.status = MotorState.FIRING
            else:
                frame.status = MotorState.IDLE
            
            frame.systemStatus = SystemStatus.WORKING
            
            logger.debug(
                f"Parsed: time={frame.time_ms}ms, "
                f"thrust={frame.thrust}N, "
                f"pressure={frame.chamberPressure}PSI, "
                f"state={frame.systemState.name}"
            )
            
            return frame
            
        except (ValueError, IndexError) as e:
            logger.error(f"Error parsing telemetry values: {e}")
            return None
        
    except Exception as e:
        logger.error(f"Parse error for '{raw_string[:50]}...': {e}")
        return None

# ==================== WEBSOCKET MANAGER ====================

class ConnectionManager:
    """Manages WebSocket connections and Telnet bridge"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.telnet_client: Optional[TelnetClient] = None

        # STATE
        self.motor_state = MotorState.IDLE
        self.system_state = SystemState.SYSTEM_SAFE
        self.fire_start_time = None

        # BACKEND LOGGING
        self.logging = False
        self.log_file = None
        self.csv_writer = None
        
        # Calibration state
        self.calibration_pending = False

        self.telemetry_stats = {
            "frames_received": 0,
            "frames_parsed": 0,
            "last_frame_time": None
        }

    def start_logging(self, filename: Optional[str] = None) -> Tuple[bool, Optional[str]]:
        """Open a CSV file and enable logging. Returns (success, filename_or_error)."""
        if self.logging:
            return False, "ALREADY_LOGGING"

        try:
            if not filename:
                filename = f"manual_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

            self.log_file = open(filename, "w", newline="")
            self.csv_writer = csv.writer(self.log_file)
            self.csv_writer.writerow([
                "timestamp", "time_ms", "thrust", "pressure",
                "temp1", "temp2", "temp3", "temp4", "temp5",
                "temp6", "temp7", "temp8", "temp9", "temp10", "temp11",
                "cont1", "cont2", "system_status", "motor_state", "system_state"
            ])
            self.log_file.flush()
            self.logging = True
            logger.info(f"Logging started: {filename}")
            return True, filename

        except Exception as e:
            logger.error(f"Failed to start logging: {e}")
            try:
                if self.log_file:
                    self.log_file.close()
            except:
                pass
            self.log_file = None
            self.csv_writer = None
            self.logging = False
            return False, str(e)

    def stop_logging(self) -> Tuple[bool, Optional[str]]:
        """Close CSV file and disable logging. Returns (success, error_message)."""
        if not self.logging and not self.log_file:
            return False, "NOT_LOGGING"

        try:
            if self.log_file:
                try:
                    self.log_file.close()
                except Exception:
                    pass

            self.log_file = None
            self.csv_writer = None
            self.logging = False
            logger.info("Logging stopped")
            return True, None

        except Exception as e:
            logger.error(f"Error while stopping logging: {e}")
            return False, str(e)
    
    async def connect_websocket(self, websocket: WebSocket):
        """Accept new WebSocket connection"""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New WebSocket client. Total: {len(self.active_connections)}")
    
    def disconnect_websocket(self, websocket: WebSocket):
        """Remove WebSocket connection"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Remaining: {len(self.active_connections)}")
    
    async def broadcast(self, message: dict):
        """Send message to all connected clients"""
        if not self.active_connections:
            return
        
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send to client: {e}")
                disconnected.append(connection)
        
        for connection in disconnected:
            self.disconnect_websocket(connection)
    
    async def send_to_client(self, websocket: WebSocket, message: dict):
        """Send message to specific client"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Failed to send to specific client: {e}")
    
    async def process_telemetry_line(self, line: str):
        """Process a telemetry line from Telnet"""
        self.telemetry_stats["frames_received"] += 1

        frame = parse_telemetry_string(line)
        if frame:
            self.telemetry_stats["frames_parsed"] += 1
            self.telemetry_stats["last_frame_time"] = datetime.now().isoformat()
            
            # Update system state from telemetry (SOURCE OF TRUTH)
            self.system_state = frame.systemState
            
            # Update motor state for compatibility
            if self.system_state == SystemState.SYSTEM_ARMED:
                self.motor_state = MotorState.ARMED
            elif self.system_state == SystemState.SYSTEM_IGNITION:
                self.motor_state = MotorState.FIRING
            else:
                self.motor_state = MotorState.IDLE
            
            frame.status = self.motor_state
            
            # Manage fire start time based on telemetry SOURCE OF TRUTH
            if self.system_state == SystemState.SYSTEM_IGNITION:
                if not self.fire_start_time:
                    self.fire_start_time = datetime.now().timestamp()
            else:
                # Clear any previous fire timer when not in ignition
                self.fire_start_time = None

            # Handle mission time for firing state
            if self.motor_state == MotorState.FIRING and self.fire_start_time:
                frame.time_ms = (datetime.now().timestamp() - self.fire_start_time) * 1000
            
            # Log data if logging is active
            if self.logging and self.csv_writer:
                self.csv_writer.writerow([
                    frame.timestamp,
                    frame.time_ms,
                    frame.thrust,
                    frame.chamberPressure,
                    *[t.value if t.status == "WORKING" else "ERROR" for t in frame.temperatures],
                    frame.continuityVoltages[0],
                    frame.continuityVoltages[1],
                    frame.systemStatus.value,
                    frame.status.value,
                    frame.systemState.name
                ])
                self.log_file.flush()

            # Broadcast to all clients
            await self.broadcast({
                "type": "telemetry",
                "data": frame.to_dict()
            })
            
            if self.telemetry_stats["frames_parsed"] % 100 == 0:
                logger.info(f"Processed {self.telemetry_stats['frames_parsed']} frames")
    
    async def start_telnet_client(self):
        """Start Telnet client to connect to ESP"""
        self.telnet_client = TelnetClient(ESP_HOST, ESP_PORT)
        await self.telnet_client.start_reading(self.process_telemetry_line)
    
    async def stop_telnet_client(self):
        """Stop Telnet client"""
        if self.telnet_client:
            await self.telnet_client.stop()

# ==================== FASTAPI APP ====================

app = FastAPI(title="Static Fire Test - Telnet WebSocket Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()

@app.get("/")
async def root():
    """Health check endpoint"""
    telnet_status = "connected" if manager.telnet_client and manager.telnet_client.is_connected else "disconnected"
    
    return {
        "status": "online",
        "service": "Static Fire Test Telnet Bridge",
        "clients": len(manager.active_connections),
        "telnet": telnet_status,
        "esp_host": ESP_HOST,
        "stats": manager.telemetry_stats,
        "system_state": manager.system_state.name,
        "motor_state": manager.motor_state.value
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Main WebSocket endpoint for telemetry data"""
    await manager.connect_websocket(websocket)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "control":
                raw_command = data.get("command", "")
                command = raw_command.upper()
                logger.info(f"Received control command: {command}")
                
                response = "ERROR:UNKNOWN_COMMAND"
                
                # Handle commands - CONSISTENT LOGIC
                if command == "ARM":
                    if manager.telnet_client:
                        response = await manager.telnet_client.send_command("ARM")
                        # Do not override system state here - telemetry is source of truth
                    else:
                        response = "ERROR:NOT_CONNECTED"
                
                elif command == "DAR":
                    if manager.telnet_client:
                        response = await manager.telnet_client.send_command("DAR")
                        # Do not override system state here - telemetry is source of truth
                    else:
                        response = "ERROR:NOT_CONNECTED"
                
                elif command == "FIR":
                    if manager.system_state == SystemState.SYSTEM_ARMED:
                        if manager.telnet_client:
                            response = await manager.telnet_client.send_command("FIR")
                            # Do not set system_state or fire_start_time here; wait for telemetry
                        else:
                            response = "ERROR:NOT_CONNECTED"
                    else:
                        response = "ERROR:INVALID_STATE"

                elif command == "RST":
                    # Reset from POST_IGNITION -> SAFE. Allowed only when system reports POST_IGNITION.
                    if manager.system_state == SystemState.SYSTEM_POST_IGNITION:
                        if manager.telnet_client:
                            response = await manager.telnet_client.send_command("RST")
                            # Do not override system_state here; telemetry will report SAFE when it happens.
                        else:
                            response = "ERROR:NOT_CONNECTED"
                    else:
                        response = "ERROR:INVALID_STATE"
                
                elif command == "SLG":
                    if manager.telnet_client:
                        response = await manager.telnet_client.send_command("SLG")
                    else:
                        response = "ERROR:NOT_CONNECTED"

                    # Toggle backend telemetry logging only when ESP ACKs
                    if response == "ACK":
                        if manager.logging:
                            ok, err = manager.stop_logging()
                            if not ok:
                                logger.error(f"stop_logging failed: {err}")
                                response = f"ERROR:LOG_STOP_FAILED:{err}"
                        else:
                            filename = f"static_fire_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
                            ok, result = manager.start_logging(filename=filename)
                            if not ok:
                                response = f"ERROR:LOG_START_FAILED:{result}"
                
                elif command.startswith("CAL"):
                    # CAL command must be either 'CAL 0' (tare) or 'CAL <integer>' (scale)
                    parts = raw_command.split()
                    if len(parts) != 2:
                        response = "ERROR:INVALID_CAL_FORMAT"
                    else:
                        cal_arg = parts[1]
                        if cal_arg == "0":
                            full = "CAL 0"
                        else:
                            # must be a whole integer
                            if cal_arg.lstrip('-').isdigit():
                                full = f"CAL {int(cal_arg)}"
                            else:
                                full = None

                        if full is None:
                            response = "ERROR:INVALID_CAL_VALUE"
                        else:
                            if manager.telnet_client:
                                response = await manager.telnet_client.send_command(full)
                                if response == "ACK":
                                    if full == "CAL 0":
                                        manager.calibration_pending = True
                                    else:
                                        manager.calibration_pending = False
                            else:
                                response = "ERROR:NOT_CONNECTED"
                
                elif command.startswith("TIM"):
    # TIM command from second code
                    parts = raw_command.split(" ", 1)
                    test_name = parts[1] if len(parts) > 1 else ""
                    timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    full_command = f"TIM {test_name} {timestamp_str}"
    
                    if manager.telnet_client:
                        # Forward TIM to ESP. The ESP handles SD-card markers itself; do not duplicate in server CSV.
                        response = await manager.telnet_client.send_command(full_command)
                        logger.info(f"Sent timestamp to ESP: {full_command}")
                    else:
                        response = "ERROR:NOT_CONNECTED"
                # Send response back
                await manager.send_to_client(websocket, {
                    "type": "ack",
                    "command": command,
                    "response": response,
                    "systemState": manager.system_state.name,
                    "timestamp": datetime.now().isoformat()
                })
                
    except WebSocketDisconnect:
        logger.warning("WebSocket disconnected")
        # Ensure logging is stopped cleanly on disconnect
        if manager.logging or manager.log_file:
            ok, err = manager.stop_logging()
            if not ok:
                logger.error(f"Failed to stop logging on disconnect: {err}")

        manager.disconnect_websocket(websocket)
        
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect_websocket(websocket)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(manager.start_telnet_client())
    
    logger.info(f"""
    ========================================
    Static Fire Test - Telnet Bridge Server
    ========================================
    ESP Telnet Target: {ESP_HOST}:{ESP_PORT}
    WebSocket Server: ws://localhost:{WS_PORT}/ws
    Web Dashboard: http://localhost:3000
    Press Ctrl+C to stop the server
    """)

@app.on_event("shutdown")
async def shutdown_event():
    await manager.stop_telnet_client()
    logger.info("Server shutting down")

if __name__ == "__main__":
    import uvicorn
    
    try:
        import fastapi
        import uvicorn
        import telnetlib
        logger.info("All dependencies loaded successfully")
    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        logger.info("Install with: pip install fastapi uvicorn")
        sys.exit(1)
    
    # CORRECTED: Added host parameter back
    uvicorn.run(
        "server:app",
        host=WS_HOST,  # ADDED BACK
        port=WS_PORT,
        reload=True,
        log_level="info"
    )