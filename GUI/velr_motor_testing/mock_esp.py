#!/usr/bin/env python3
"""
Mock ESP Telemetry Server - EXACT Arduino Simulation
"""

import asyncio
import random
import time
import logging
from enum import Enum
import socket

# ==================== CONFIGURATION ====================

TELNET_HOST = "0.0.0.0"
TELNET_PORT = 2323

# ==================== STATE ENUMS ====================

class SystemState(int, Enum):
    SYSTEM_SAFE = 0
    SYSTEM_IDLE = 1
    SYSTEM_ARMED = 2
    SYSTEM_IGNITION = 3
    SYSTEM_POST_IGNITION = 4

# ==================== EXACT ARDUINO SIMULATION ====================

class MockESP:
    """EXACT simulation of Arduino ESP code"""
    
    def __init__(self):
        self.state = SystemState.SYSTEM_IDLE  # Start in IDLE state
        self.is_logging = False
        self.ignition_start_time = None
        self.ignition_duration = 5.0  # 5 seconds
        
        # Sensor data - FIXED: 11 temperatures (10 + board temp)
        self.temperatures = [0] * 11  # 11 temperatures total
        self.board_temp = 0
        self.pressure = 0
        self.thrust = 0.0
        self.raw_thrust = 0
        self.last_raw_thrust_for_cal = 0
        
        # Calibration
        self.thrust_offset = -189700
        self.thrust_scale_factor = 0.109
        
        # Timing
        self.start_time = time.time()
        self.last_temp_read = 0
        self.telemetry_decimator = 0
        self.last_flush_time = 0
        
        # File logging simulation
        self.log_entries = []
        
        # Buffer simulation
        self.ring_buffer = []
        self.buf_head = 0
        self.buf_tail = 0
        
        self.logger = logging.getLogger("MockESP")
        
    def _read_temperatures(self):
        """Simulate temperature reading (called every 100ms = 10Hz)"""
        current_time = time.time()
        
        # Simulate MAX31855 sensors (6 sensors)
        for i in range(6):
            # Random temperature with occasional faults
            if random.random() < 0.98:  # 98% chance of good reading
                base_temp = 25 + (i * 2) + random.uniform(-0.5, 0.5)
                # Convert to Arduino format: (temp * 4) << 2
                self.temperatures[i] = int(base_temp * 4) << 2  # Good reading, status bits 00
            else:
                # Simulate fault (1% each type)
                fault = random.randint(1, 3)
                self.temperatures[i] = fault  # Status bits: 01=OPEN, 10=SHORT_GND, 11=SHORT_VCC
        
        # Simulate analog sensors (4 sensors)
        for i in range(6, 10):
            base_temp = 25 + (i * 2) + random.uniform(-0.5, 0.5)
            self.temperatures[i] = int(base_temp * 10)  # * 0.1 deg C in Arduino
        
        # Board temperature (internal) - stored at index 10
        self.board_temp = int(28.0 * 16)  # * 0.0625 in Arduino
        self.temperatures[10] = self.board_temp
        
        self.last_temp_read = current_time
    
    def _generate_thrust_data(self):
        """Simulate thrust data from load cell interrupt"""
        current_time = time.time()
        elapsed = current_time - self.start_time
        
        # Different thrust behavior based on state
        if self.state == SystemState.SYSTEM_IGNITION:
            # During ignition: high thrust with noise
            self.thrust = 500 + 50 * random.random() + 100 * (elapsed % 0.1)
            self.raw_thrust = int(self.thrust / self.thrust_scale_factor + self.thrust_offset)
        else:
            # Normal: small noise around zero
            self.thrust = random.uniform(-5, 5)
            self.raw_thrust = self.thrust_offset + int(self.thrust / self.thrust_scale_factor)
        
        self.last_raw_thrust_for_cal = self.raw_thrust
        
        # Add to ring buffer (simulating interrupt)
        timestamp = int(current_time * 1e6)  # microseconds
        
        # Simulate ring buffer
        if len(self.ring_buffer) < 64:
            self.ring_buffer.append({
                'timestamp': timestamp,
                'raw_thrust': self.raw_thrust
            })
    
    def _format_temperature(self, temp_val, index):
        """Format temperature exactly like Arduino printTelemetry"""
        if index < 6:  # MAX31855 sensors
            status = temp_val & 0x03
            if status == 0:
                temp_celsius = (temp_val >> 2) * 0.25
                return f"{temp_celsius:.2f}"
            elif status == 1:
                return "OPEN"
            elif status == 2:
                return "Short GND"
            elif status == 3:
                return "Short VCC"
        elif index < 10:  # Analog sensors (6-9)
            return f"{temp_val / 10.0:.1f}"
        else:  # Board temperature (index 10)
            return f"{temp_val * 0.0625:.2f}"  # * 0.0625 for board temp
    
    def generate_telemetry(self):
        """Generate telemetry EXACTLY like Arduino code - FIXED to have 15 values"""
        current_time = time.time()
        
        # Read temperatures at 10Hz
        if current_time - self.last_temp_read >= 0.1:
            self._read_temperatures()
        
        # Generate thrust data
        self._generate_thrust_data()
        
        # Handle ignition timer
        if self.state == SystemState.SYSTEM_IGNITION and self.ignition_start_time:
            if current_time - self.ignition_start_time > self.ignition_duration:
                self.state = SystemState.SYSTEM_POST_IGNITION
                self.logger.info("Auto cutoff: Ignition duration completed")
        
        # Process ring buffer (like Arduino loop)
        if self.ring_buffer:
            data = self.ring_buffer.pop(0)
            timestamp = data['timestamp']
            raw_thrust = data['raw_thrust']
            
            # Sign extension for 24-bit number (like Arduino)
            if raw_thrust & 0x00800000:
                raw_thrust |= 0xFF000000
            
            # Calculate thrust (like Arduino)
            thrust = ((raw_thrust - self.thrust_offset) * self.thrust_scale_factor)
            
            # Decimate telemetry (8:1 like Arduino)
            if self.telemetry_decimator == 0:
                # Build telemetry string EXACTLY like Arduino
                telemetry_parts = [
                    str(timestamp),
                    f"{thrust:.2f}",
                    f"{self.pressure}",
                ]
                
                # ALL 11 temperatures (T1-T10 + T11 board temp)
                for i in range(11):
                    if i < len(self.temperatures):
                        telemetry_parts.append(self._format_temperature(self.temperatures[i], i))
                    else:
                        telemetry_parts.append("0.0")  # Default value
                
                # State - MUST BE INCLUDED
                telemetry_parts.append(str(self.state.value))
                
                # COUNT THE VALUES - should be 15 total (timestamp, thrust, pressure, 11 temps, state)
                if len(telemetry_parts) != 15:
                    self.logger.error(f"Wrong number of telemetry values: {len(telemetry_parts)}")
                    # Ensure we have exactly 15 values
                    while len(telemetry_parts) < 15:
                        telemetry_parts.append("0.0")
                    telemetry_parts = telemetry_parts[:15]  # Trim if too many
                
                telemetry = ",".join(telemetry_parts)
                
                # Update decimator
                self.telemetry_decimator = (self.telemetry_decimator + 1) % 8
                
                return telemetry
            
            self.telemetry_decimator = (self.telemetry_decimator + 1) % 8
        
        return None
    
    def process_command(self, command: str) -> str:
        """Process commands EXACTLY like Arduino ProcessCommand function - FIXED TIM command"""
        cmd = command.strip().upper()
        original_cmd = command.strip()  # Keep original for TIM logging
        self.logger.info(f"Processing command: {cmd}")
        
        # Get current time in microseconds (simulated)
        cmd_time = int(time.time() * 1e6)
        
        # Handle TIM command specially FIRST
        if cmd.startswith("TIM"):
            # TIM command format: TIM <test_name> <timestamp>
            parts = original_cmd.split(" ", 2)  # Split into max 3 parts
            if len(parts) >= 2:
                test_name = parts[1]
                timestamp_str = parts[2] if len(parts) > 2 else time.strftime("%Y-%m-%d %H:%M:%S")
                
                # Log timestamp marker to CSV if logging
                if self.is_logging:
                    # Create a special marker entry
                    marker_entry = f"{cmd_time},TIMESTAMP,{test_name},{timestamp_str}"
                    self.log_entries.append(marker_entry)
                    self.logger.info(f"Timestamp marker added: {test_name} at {timestamp_str}")
                
                # Also log the command itself
                if self.is_logging:
                    log_entry = f"{cmd_time},CMD,{original_cmd}"
                    self.log_entries.append(log_entry)
                
                return "ACK"
            else:
                return "ERR: TIM command requires test name"
        
        # Log other commands if logging enabled
        if self.is_logging:
            log_entry = f"{cmd_time},CMD,{original_cmd}"
            self.log_entries.append(log_entry)
        
        if cmd == "ARM":
            # Only allow ARM from IDLE or SAFE
            if self.state in [SystemState.SYSTEM_IDLE, SystemState.SYSTEM_SAFE]:
                # Start Logging
                if not self.is_logging:
                    # Simulate SD card open
                    self.is_logging = True
                    self.state = SystemState.SYSTEM_ARMED
                    # Write header if first time
                    if len(self.log_entries) == 0:
                        self.log_entries.append("Time(us),Thrust(N),Pressure,T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11,State")
                    
                    self.log_entries.append(f"{cmd_time},CMD,ARM")
                    return "ACK"
                else:
                    self.state = SystemState.SYSTEM_ARMED
                    return "ACK"
            else:
                return "FAULT: INVALID STATE"
        
        elif cmd == "DAR":
            self.state = SystemState.SYSTEM_IDLE
            return "ACK"
        
        elif cmd == "RST":
            if self.state == SystemState.SYSTEM_POST_IGNITION:
                self.state = SystemState.SYSTEM_SAFE
                return "ACK"
            else:
                return "FAULT: NOT IN POST_IGNITION"
        
        elif cmd == "FIR":
            if self.state == SystemState.SYSTEM_ARMED:
                self.state = SystemState.SYSTEM_IGNITION
                self.ignition_start_time = time.time()
                return "ACK"
            else:
                return "FAULT: NOT ARMED"
        
        elif cmd == "SLG":
            if self.is_logging:
                self.is_logging = False
                # Save log to file
                if self.log_entries:
                    filename = f"datalog_{int(time.time())}.csv"
                    with open(filename, 'w') as f:
                        f.write("\n".join(self.log_entries))
                    self.logger.info(f"Log saved to {filename}")
                    self.log_entries = []
                return "ACK"
            else:
                # Start manual logging
                self.is_logging = True
                self.log_entries = ["Time(us),Thrust(N),Pressure,T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11,State"]
                return "ACK"
        
        elif cmd.startswith("CAL"):
            # Parse calibration command
            try:
                val_str = cmd[3:].strip()
                if val_str == "":
                    # CAL with no argument: set offset
                    self.thrust_offset = self.last_raw_thrust_for_cal
                    return f"Offset set to: {self.thrust_offset}\nACK"
                else:
                    # CAL with argument: set scale factor
                    val = float(val_str)
                    if self.last_raw_thrust_for_cal != self.thrust_offset:
                        self.thrust_scale_factor = val / (self.last_raw_thrust_for_cal - self.thrust_offset)
                        return f"Scale set to: {self.thrust_scale_factor}\nACK"
                    else:
                        return "FAULT: DIVIDE BY ZERO"
            except ValueError:
                return "FAULT: INVALID CAL VALUE"
        
        else:
            return f"ERR: Unknown command '{command}'"

# ==================== TELNET SERVER - FIXED ====================

class MockESPServer:
    """Telnet server that sends ACK IMMEDIATELY and telemetry at correct rate"""
    
    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        self.esp = MockESP()
        self.server = None
        self.running = False
        self.logger = logging.getLogger("MockESPServer")
        
        # Telemetry rate control
        self.last_telemetry_time = 0
        self.telemetry_interval = 0.0125  # 80Hz (Arduino sends every 8th sample at ~80Hz)
    
    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle client - ACK FIRST, telemetry second"""
        addr = writer.get_extra_info('peername')
        self.logger.info(f"New connection from {addr}")
        
        # Send welcome
        welcome = "Mock ESP - Arduino Simulation\n\n"
        writer.write(welcome.encode())
        await writer.drain()
        
        # Buffer for commands
        buffer = b""
        
        try:
            while self.running:
                current_time = time.time()
                
                # 1. READ COMMANDS (HIGH PRIORITY)
                try:
                    # Read with tiny timeout
                    data = await asyncio.wait_for(reader.read(1024), timeout=0.001)
                    if data:
                        buffer += data
                        
                        # Process complete commands
                        while b'\n' in buffer:
                            line, buffer = buffer.split(b'\n', 1)
                            command = line.decode('ascii', errors='ignore').strip()
                            if command:
                                # PROCESS AND SEND ACK IMMEDIATELY
                                response = self.esp.process_command(command)
                                writer.write(f"{response}\n".encode())
                                await writer.drain()  # FLUSH IMMEDIATELY
                                self.logger.info(f"Command: {command} -> {response}")
                except asyncio.TimeoutError:
                    pass
                
                # 2. SEND TELEMETRY (LOWER PRIORITY, at correct rate)
                if current_time - self.last_telemetry_time >= self.telemetry_interval:
                    telemetry = self.esp.generate_telemetry()
                    if telemetry:
                        writer.write(f"{telemetry}\n".encode())
                        await writer.drain()
                    self.last_telemetry_time = current_time
                
                # Small sleep to prevent CPU hogging
                await asyncio.sleep(0.001)
                
        except (ConnectionResetError, BrokenPipeError):
            self.logger.info(f"Client {addr} disconnected")
        except Exception as e:
            self.logger.error(f"Error: {e}")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except:
                pass
    
    async def start(self):
        """Start server"""
        self.running = True
        self.server = await asyncio.start_server(
            self.handle_client,
            self.host,
            self.port
        )
        
        addr = self.server.sockets[0].getsockname()
        print(f"Mock ESP Server running on {addr}")
        print(f"System starts in IDLE state")
        print(f"Connect with: telnet {addr[0]} {addr[1]}")
        print(f"Waiting for connections...")
        
        async with self.server:
            await self.server.serve_forever()
    
    async def stop(self):
        """Stop server"""
        self.running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()

# ==================== MAIN ====================

async def main():
    logging.basicConfig(level=logging.INFO)
    
    server = MockESPServer(TELNET_HOST, TELNET_PORT)
    
    print("=" * 60)
    print("MOCK ESP - ARDUINO EXACT SIMULATION")
    print("=" * 60)
    print("Features:")
    print("1. ACK sent IMMEDIATELY when command received")
    print("2. Telemetry at correct Arduino rate (80Hz effective)")
    print("3. Exact same state machine as Arduino code")
    print("4. Same command responses as Arduino")
    print("5. TIM command logging to CSV")
    print("6. FIXED: 15-value telemetry (timestamp, thrust, pressure, 11 temps, state)")
    print("=" * 60)
    
    try:
        await server.start()
    except KeyboardInterrupt:
        print("\nShutting down...")
        await server.stop()

if __name__ == "__main__":
    asyncio.run(main())