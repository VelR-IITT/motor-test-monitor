export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export enum MotorState {
  IDLE = 'IDLE',
  ARMED = 'ARMED',
  FIRING = 'FIRING',
  ABORT = 'ABORT',
  SAFE = 'SAFE'
}

export enum SystemState {
  SYSTEM_SAFE = "SYSTEM_SAFE",
  SYSTEM_IDLE = "SYSTEM_IDLE", 
  SYSTEM_ARMED = "SYSTEM_ARMED",
  SYSTEM_IGNITION = "SYSTEM_IGNITION",
  SYSTEM_POST_IGNITION = "SYSTEM_POST_IGNITION"
}

export enum SystemStatus {
  WORKING = 'WORKING',
  ERROR = 'ERROR'
}

export interface TemperatureSensor {
  value: number;
  status: 'WORKING' | 'ERROR';
}

export interface TelemetryFrame {
  timestamp: number;
  
  // New time field from backend (milliseconds)
  timeMs: number;
  
  // Legacy time fields (keep for compatibility)
  timeStart?: number; 
  missionTime?: number;
  
  // Measurement fields
  thrust: number; // Newtons
  chamberPressure: number; // PSI
  
  // Temperatures - Now 11 sensors
  temperatures: TemperatureSensor[];
  
  // Continuity voltages (2 channels)
  continuityVoltages: [number, number];
  
  // System status (from backend - will be WORKING)
  systemStatus: SystemStatus;
  
  // Motor state (compatibility)
  status: MotorState;
  
  // System state (0-4 from backend)
  systemState: SystemState;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'ERROR' | 'DATA';
}

export interface SensorConfig {
  id: number;
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  label: string;
}

export interface TelemetryService {
  connect(host: string, port: number): Promise<void>;
  disconnect(): void;
  sendCommand(command: string): Promise<{ response?: string; systemState?: SystemState | string; command?: string }>;
  reset(): void;
}

// Constant for temperature sensor count
export const TEMPERATURE_SENSOR_COUNT = 11;