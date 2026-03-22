import { ConnectionStatus, MotorState, SystemState, SystemStatus, TelemetryFrame, TelemetryService } from '../types';

type TelemetryCallback = (data: TelemetryFrame) => void;
type LogCallback = (msg: string) => void;

export class TelnetSimulator implements TelemetryService {
  private intervalId: number | null = null;
  private connectTimeout: number | null = null;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private motorState: MotorState = MotorState.IDLE;
  private onData: TelemetryCallback;
  private onLog: LogCallback;
  
  // Simulation physics state
  private connectionTime: number = 0;
  private fireDuration: number = 5000; // 5 seconds burn
  private isFiring: boolean = false;
  private fireStartTime: number = 0; // 0 means not started

  // Sensor drift simulation
  private tempOffsets: number[] = Array(11).fill(0).map(() => (Math.random() * 2) - 1);

  constructor(onData: TelemetryCallback, onLog: LogCallback) {
    this.onData = onData;
    this.onLog = onLog;
  }

  public connect(host: string, port: number): Promise<void> {
    // Validate IP (Basic Regex)
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(host) && host !== 'localhost') {
        this.onLog(`Error: "${host}" is not a valid IP address.`);
        return Promise.reject(new Error("Invalid IP"));
    }

    this.status = ConnectionStatus.CONNECTING;
    this.onLog(`[SIM] Attempting connection to ${host}:${port}...`);
    
    return new Promise((resolve, reject) => {
      // Clear any existing pending connection
      if (this.connectTimeout) clearTimeout(this.connectTimeout);

      this.connectTimeout = window.setTimeout(() => {
        this.status = ConnectionStatus.CONNECTED;
        this.connectionTime = Date.now();
        this.onLog(`[SIM] Connected to ${host}:${port}`);
        this.startDataStream();
        resolve();
      }, 1500);
    });
  }

  public disconnect() {
    if (this.intervalId) {
        window.clearInterval(this.intervalId);
        this.intervalId = null;
    }
    if (this.connectTimeout) {
        window.clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
    }
    this.status = ConnectionStatus.DISCONNECTED;
    this.onLog('[SIM] Connection terminated.');
  }

  public reset() {
    this.disconnect();
    this.motorState = MotorState.IDLE;
    this.isFiring = false;
    this.fireStartTime = 0;
    this.connectionTime = Date.now(); 
    this.onLog('--- [SIM] SYSTEM RESET COMPLETE ---');
  }

  public sendCommand(command: string): Promise<{ response?: string; command?: string }> {
    if (this.status !== ConnectionStatus.CONNECTED) {
      this.onLog('ERROR: Not connected. Cannot send command.');
      return Promise.reject(new Error('ERROR:NOT_CONNECTED'));
    }

    this.onLog(`TX > ${command}`);

    return new Promise((resolve, reject) => {
      // Safety critical commands like ABORT should be processed immediately
      if (command === 'CMD:ABORT' || command === 'ABORT') {
        const ok = this.processCommand(command);
        if (ok) resolve({ response: 'ACK', command });
        else reject(new Error(`ERR:${command}`));
        return;
      }

      setTimeout(() => {
        // Check status again to prevent processing commands if disconnected/reset in the meantime
        if (this.status !== ConnectionStatus.CONNECTED) {
          reject(new Error('ERROR:NOT_CONNECTED'));
          return;
        }

        const ok = this.processCommand(command);
        if (ok) resolve({ response: 'ACK', command });
        else reject(new Error(`ERR:${command}`));
      }, 200);
    });
  }

  private processCommand(command: string): boolean {
    const baseCommand = command.split(' ')[0].toUpperCase();

    switch (command) {
      case 'CMD:ARM':
      case 'ARM':
        this.motorState = MotorState.ARMED;
        this.onLog('RX < ACK: SYSTEM ARMED');
        return true;
      case 'CMD:DISARM':
      case 'DAR':
        this.motorState = MotorState.IDLE;
        this.onLog('RX < ACK: SYSTEM DISARMED');
        return true;
      case 'CMD:FIRE':
      case 'FIR':
        if (this.motorState === MotorState.ARMED) {
          this.motorState = MotorState.FIRING;
          this.isFiring = true;
          this.fireStartTime = Date.now();
          this.onLog('RX < ACK: IGNITION SEQUENCE STARTED');
          return true;
        } else {
          this.onLog('RX < ERR: SYSTEM NOT ARMED');
          return false;
        }
      case 'CMD:ABORT':
      case 'ABORT':
        this.motorState = MotorState.ABORT;
        this.isFiring = false;
        this.onLog('RX < ACK: MANUAL ABORT TRIGGERED');
        return true;
      case 'CMD:RESET':
        this.reset();
        return true;
      default:
        if (baseCommand === 'SLG' || baseCommand === 'TIM' || baseCommand === 'CAL') {
          this.onLog(`RX < ACK: ${command}`);
          return true;
        }
        this.onLog(`RX < ERR: UNKNOWN COMMAND "${command}"`);
        return false;
    }
  }

  private startDataStream() {
    if (this.intervalId) clearInterval(this.intervalId);
    
    this.intervalId = window.setInterval(() => {
      if (this.status !== ConnectionStatus.CONNECTED) return;
      
      const now = Date.now();
      const frame = this.generateSimulatedFrame(now);
      this.onData(frame);
    }, 100); // 10Hz update rate
  }

  private generateSimulatedFrame(timestamp: number): TelemetryFrame {
    // Continuous time since connection
    const timeStart = (timestamp - this.connectionTime) / 1000;
    
    let thrust = 0;
    let pressure = 14.7; // Ambient PSI
    let missionTime = 0;

    // Base temps (ambient) ~25C
    const temperatures = Array(11).fill(25);

    // Calculate Mission Time (Persistent after fire)
    if (this.fireStartTime > 0) {
        missionTime = (timestamp - this.fireStartTime) / 1000;
    }

    if (this.isFiring) {
      if (missionTime * 1000 < this.fireDuration) {
        // Burn Phase
        const progress = (missionTime * 1000) / this.fireDuration;
        
        // Rise fast, plateau, tail off
        if (progress < 0.1) thrust = 2500 * (progress * 10);
        else if (progress > 0.8) thrust = 2500 * (1 - (progress - 0.8) * 5);
        else thrust = 2500 + (Math.random() * 100 - 50);

        pressure = 14.7 + (thrust * 0.4) + (Math.random() * 20);

        // Heat soak simulation for 11 sensors
        for (let i = 0; i < 11; i++) {
            // Sensors closer to nozzle (arbitrarily indices 7-9) heat faster
            const heatRate = i > 6 ? 0.8 : 0.1;
            temperatures[i] = 25 + (missionTime * 1000 * 0.005 * (i + 1) * heatRate);
        }

      } else {
        // Burnout
        this.isFiring = false;
        this.motorState = MotorState.SAFE;
        this.onLog('RX < EVENT: BURNOUT DETECTED');
      }
    } else if (this.motorState === MotorState.SAFE || this.motorState === MotorState.ABORT) {
       // Cooling phase logic
       // If we fired, use missionTime to simulate cooling curve
       if (this.fireStartTime > 0) {
           for (let i = 0; i < 11; i++) {
                // Simplified cooling
                const peakTime = this.fireDuration / 1000;
                const coolingFactor = Math.max(0, missionTime - peakTime);
                const peakTemp = 25 + (this.fireDuration * 0.005 * (i + 1) * (i > 6 ? 0.8 : 0.1));
                temperatures[i] = Math.max(25, peakTemp - (coolingFactor * 2));
           }
       }
    }

    // Apply noise and offsets
    const noisyTemps = temperatures.map((t, i) => t + this.tempOffsets[i] + (Math.random() * 0.5 - 0.25));

    return {
      timestamp,
      timeMs: missionTime * 1000,
      timeStart,
      missionTime,
      thrust: Math.max(0, thrust + ((Math.random() * 0.5 - 0.25) * 10)),
      chamberPressure: Math.max(0, pressure + (Math.random() * 0.5 - 0.25)),
      temperatures: noisyTemps.map(value => ({ value, status: 'WORKING' as const })),
      continuityVoltages: [0, 0],
      systemStatus: SystemStatus.WORKING,
      status: this.motorState,
      systemState: this.motorState === MotorState.ARMED
        ? SystemState.SYSTEM_ARMED
        : this.motorState === MotorState.FIRING
          ? SystemState.SYSTEM_IGNITION
          : SystemState.SYSTEM_SAFE
    };
  }
}