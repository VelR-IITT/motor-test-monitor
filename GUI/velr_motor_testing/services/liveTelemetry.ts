import { TelemetryFrame, TelemetryService, ConnectionStatus } from '../types';

type TelemetryCallback = (data: TelemetryFrame) => void;
type LogCallback = (msg: string) => void;
type StatusChangeCallback = (status: ConnectionStatus) => void;

export class LiveTelemetryService implements TelemetryService {
  private socket: WebSocket | null = null;
  private onData: TelemetryCallback;
  private onLog: LogCallback;
  private onStatusChange: StatusChangeCallback;
  private pendingCommands: Map<string, {
    resolve: (value?: { response?: string; systemState?: string; command?: string }) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
    command: string; // Store original command for logging
  }> = new Map();
  
  // Counter for generating unique command IDs
  private commandCounter = 0;

  constructor(
    onData: TelemetryCallback,
    onLog: LogCallback,
    onStatusChange: StatusChangeCallback
  ) {
    this.onData = onData;
    this.onLog = onLog;
    this.onStatusChange = onStatusChange;
  }

  public connect(_: string, __: number): Promise<void> {
    const url = "ws://localhost:8000/ws";

    this.onLog(`[WS] Connecting to ${url}...`);
    this.onStatusChange(ConnectionStatus.CONNECTING);

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }

      this.socket.onopen = () => {
        this.onLog(`[WS] Connected to backend`);
        this.onStatusChange(ConnectionStatus.CONNECTED);
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // ---- TELEMETRY ----
          if (msg.type === 'telemetry' && msg.data) {
            this.onData(msg.data as TelemetryFrame);
          }

          // ---- ACK ----
          else if (msg.type === 'ack' && msg.command) {
            this.onLog(`ACK < ${msg.command} (${msg.response ?? 'NO_RESPONSE'})`);
            
            // The backend might send back a different case or format
            // Try to find a matching pending command (case-insensitive)
            const ackCommand = msg.command.toUpperCase().trim();
            
            // Log all pending commands for debugging
            if (this.pendingCommands.size > 0) {
              this.onLog(`Pending commands: ${Array.from(this.pendingCommands.keys()).join(', ')}`);
            }
            
            // First try exact match
            let found = false;
            for (const [cmdId, pending] of this.pendingCommands.entries()) {
              const pendingUpper = pending.command.toUpperCase().trim();
              
              // Check if the ACK matches this pending command
              // For FIR, it might just be "FIR" while we sent "FIR"
              // Also handle commands with spaces like "TIM test"
              if (ackCommand === pendingUpper || 
                  ackCommand.startsWith(pendingUpper) || 
                  pendingUpper.startsWith(ackCommand)) {
                
                clearTimeout(pending.timeoutId);
                const response = String(msg.response ?? '').toUpperCase();
                if (response === 'ACK') {
                  pending.resolve({
                    response: msg.response,
                    systemState: msg.systemState,
                    command: msg.command
                  });
                } else {
                  pending.reject(new Error(msg.response || `Command ${pending.command} failed`));
                }
                this.pendingCommands.delete(cmdId);
                if (response === 'ACK') {
                  this.onLog(`✓ Command ${pending.command} acknowledged successfully`);
                } else {
                  this.onLog(`✗ Command ${pending.command} failed: ${msg.response || 'UNKNOWN_ERROR'}`);
                }
                found = true;
                break;
              }
            }
            
            // If no match found, log it but don't treat as error
            if (!found) {
              this.onLog(`⚠ No pending command found for ACK: ${ackCommand}`);
            }
          }

        } catch (err) {
          console.warn("Invalid WebSocket message", event.data);
        }
      };

      this.socket.onerror = () => {
        this.onLog(`[WS] Connection error`);
        this.onStatusChange(ConnectionStatus.ERROR);
        reject(new Error("WebSocket connection error"));
      };

      this.socket.onclose = () => {
        this.onLog(`[WS] Disconnected`);
        this.onStatusChange(ConnectionStatus.DISCONNECTED);
        
        // Reject all pending commands on disconnect
        for (const [cmdId, pending] of this.pendingCommands.entries()) {
          clearTimeout(pending.timeoutId);
          pending.reject(new Error("WebSocket disconnected"));
          this.pendingCommands.delete(cmdId);
        }
      };
    });
  }

  public sendCommand(command: string): Promise<{ response?: string; systemState?: string; command?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      // Generate a unique ID for this command
      const commandId = `cmd_${Date.now()}_${this.commandCounter++}`;
      
      // Set timeout (3000ms = 3 seconds - increased from 1000ms)
      const timeoutId = setTimeout(() => {
        const pending = this.pendingCommands.get(commandId);
        if (pending) {
          this.onLog(`⏰ Timeout: No ACK received for ${pending.command} (waited 3s)`);
          pending.reject(new Error(`Timeout: No ACK received for ${command}`));
          this.pendingCommands.delete(commandId);
        }
      }, 3000); // Increased to 3 seconds

      // Store pending command with the unique ID
      this.pendingCommands.set(commandId, {
        resolve,
        reject,
        timeoutId,
        command
      });

      // Send command
      const message = JSON.stringify({
        type: "control",
        command
      });
      
      this.socket.send(message);
      this.onLog(`TX > ${command} (ID: ${commandId})`);

      // Log number of pending commands
      this.onLog(`Pending commands: ${this.pendingCommands.size}`);
    });
  }

  public disconnect() {
    // Clear all pending timeouts
    for (const [cmdId, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timeoutId);
      this.pendingCommands.delete(cmdId);
    }
    
    this.socket?.close();
    this.socket = null;
  }

  public reset() {
    this.disconnect();
    this.onStatusChange(ConnectionStatus.DISCONNECTED);
  }
}