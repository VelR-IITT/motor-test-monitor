import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Rocket, Clock, Zap, Cpu } from 'lucide-react';
import { TelnetSimulator } from './services/telnetSimulator';
import { LiveTelemetryService } from './services/liveTelemetry';
import { TelemetryFrame, MotorState, LogEntry, ConnectionStatus, TelemetryService, SystemState } from './types';
import ControlPanel from './components/ControlPanel';
import ThrustChart from './components/ThrustChart';
import MotorVisual from './components/MotorVisual';
import { SystemStatus } from './types';

const App: React.FC = () => {
  // State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(SystemStatus.WORKING);
  const [systemState, setSystemState] = useState<SystemState>(SystemState.SYSTEM_SAFE);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryFrame[]>([]);
  const [currentFrame, setCurrentFrame] = useState<TelemetryFrame | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentTime, setCurrentTime] = useState<string>(new Date().toLocaleTimeString());
  const [testName, setTestName] = useState<string>("");
  const [logoError, setLogoError] = useState(false);
  
  // Calibration state
  const [calibrationValue, setCalibrationValue] = useState<string>("1000");
  const [calibrationPending, setCalibrationPending] = useState(false);
  
  // Reset Key to force re-mounting of components with internal state (like MotorVisual)
  const [resetKey, setResetKey] = useState(0);
  
  // Settings
  const [logoSrc, setLogoSrc] = useState('logo.jpg');
  const [ipAddress, setIpAddress] = useState('192.168.1.50');
  const [useSimulator, setUseSimulator] = useState(false);

  // Max Values State
  const [maxThrust, setMaxThrust] = useState(0);
  const [maxPressure, setMaxPressure] = useState(0);
  const [maxTemperatures, setMaxTemperatures] = useState<number[]>(Array(11).fill(0)); // Changed to 11 for T1-T10 + one extra

  // Refs for non-react state logic
  const serviceRef = useRef<TelemetryService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Command state tracking
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const commandTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCommandRef = useRef<string | null>(null); // Ref to access state inside callbacks

  // RTC Clock Interval
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize Default Service on Mount
  useEffect(() => {
    initService(useSimulator);
    return () => {
      serviceRef.current?.disconnect();
    };
  }, []);

  // Helper function to add logs
  const addLog = (message: string, type: 'INFO' | 'WARNING' | 'ERROR' = 'INFO') => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    // Keep only last 50 log entries
    setLogs(prev => {
      const newLogs = [entry, ...prev];
      return newLogs.length > 50 ? newLogs.slice(0, 50) : newLogs;
    });
  };

  const initService = (isSim: boolean) => {
    // Cleanup old service
    if (serviceRef.current) {
        serviceRef.current.disconnect();
    }

    const handleData = (frame: any) => {
      // Handle ACK / Command Responses explicitly
      if (frame.type === 'ack') {
  // Service already handled the ACK and resolved the promise
  // Just update system state if present
  if (frame.systemState) {
    setSystemState(frame.systemState);
  }
  return; // Stop processing, this is not a telemetry frame
}

      // Normal Telemetry Processing
      setCurrentFrame(frame);
      
      // System status will always be WORKING from backend
      setSystemStatus(frame.systemStatus || SystemStatus.WORKING);
      
      // Update system state from backend
      if (frame.systemState) setSystemState(frame.systemState);

  // Update Max Values - use timeMs for mission time
  setMaxThrust(prev => Math.max(prev, frame.thrust));
  setMaxPressure(prev => Math.max(prev, frame.chamberPressure));
  setMaxTemperatures(prev =>
    prev.map((max, idx) => {
      const sensor = frame.temperatures[idx];
      if (!sensor || sensor.status === 'ERROR') {
        return max;
      }
      return Math.max(max, sensor.value);
    })
  );

  // Update chart history - use timeMs for mission time
  setTelemetryHistory(prev => {
    const newHistory = [...prev, frame];
    return newHistory.length > 50 ? newHistory.slice(newHistory.length - 50) : newHistory;
  });
};

    const handleLog = (msg: string) => {
      addLog(msg, msg.includes('ERR') ? 'ERROR' : 'INFO');
    };

    if (isSim) {
        serviceRef.current = new TelnetSimulator(handleData, handleLog);
    } else {
        serviceRef.current = new LiveTelemetryService(handleData, handleLog, setConnectionStatus);
    }
  };

  // Send command with ACK tracking
  const sendCommandWithAck = async (command: string, displayName: string): Promise<boolean> => {
  if (pendingCommand) {
    addLog(`Command ${displayName} ignored: Waiting for ACK from previous command`, 'WARNING');
    return false;
  }
  
  if (!serviceRef.current) {
    addLog(`Cannot send ${displayName}: Service not available`, 'ERROR');
    return false;
  }

  // Set as pending
  setPendingCommand(command);
  pendingCommandRef.current = command;
  
  try {
    // AWAIT the command - service handles its own timeout
    addLog(`Sent: ${displayName} (${command})`, 'INFO');
    const ack = await serviceRef.current.sendCommand(command);  // <-- ADD await
    
    // If we get here, ACK was received (service resolved the promise)
    if (ack?.systemState) {
      setSystemState(ack.systemState as SystemState);
    }
    setPendingCommand(null);
    pendingCommandRef.current = null;
    return true;
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    addLog(`Command failed: ${displayName} (${msg})`, 'ERROR');
    setPendingCommand(null);
    pendingCommandRef.current = null;
    return false;
  }
};

  const handleSendTimestamp = () => {
    if (!testName.trim()) {
      addLog('Please enter a test name', 'WARNING');
      return;
    }
    void sendCommandWithAck(`TIM ${testName}`, 'TIMESTAMP');
  };

  // Toggle Handler
  const toggleMode = () => {
    if (connectionStatus !== ConnectionStatus.DISCONNECTED) return;
    const newMode = !useSimulator;
    setUseSimulator(newMode);
    addLog(`Mode changed to ${newMode ? 'SIMULATOR' : 'LIVE'}`, 'INFO');
    initService(newMode);
  };

  // Handlers
  const handleConnect = async () => {
    if (!serviceRef.current) {
      addLog('Service not initialized', 'ERROR');
      return;
    }
    try {
      addLog(`Connecting to ${ipAddress}`, 'INFO');
      setConnectionStatus(ConnectionStatus.CONNECTING);
      await serviceRef.current.connect(ipAddress, 23); 
      setConnectionStatus(ConnectionStatus.CONNECTED);
      addLog('Connected successfully', 'INFO');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Connection failed: ${errorMsg}`, 'ERROR');
      setConnectionStatus(ConnectionStatus.ERROR);
      setTimeout(() => setConnectionStatus(ConnectionStatus.DISCONNECTED), 3000);
    }
  };

  const handleDisconnect = async () => {
    if (serviceRef.current) {
      try {
        addLog('Sending SAFE command', 'INFO');
        await sendCommandWithAck('DAR', 'DISARM');
        serviceRef.current.disconnect();
        addLog('Disconnected', 'INFO');
      } catch (e) {
        addLog('Error during disconnect', 'ERROR');
      }
    }
    setIsLogging(false);
    setConnectionStatus(ConnectionStatus.DISCONNECTED);
    setPendingCommand(null);
    pendingCommandRef.current = null;
    setCalibrationPending(false); // Reset calibration state
  };

  const handleSendCommand = async (cmd: string, displayName: string) => {
    switch(cmd) {
      case 'ARM':
        await sendCommandWithAck('ARM', 'ARM');
        break;
      case 'DAR':
        await sendCommandWithAck('DAR', 'DISARM');
        break;
      case 'FIR':
        await sendCommandWithAck('FIR', 'IGNITION');
        break;
      case 'SLG':
        if (await sendCommandWithAck('SLG', 'TOGGLE_LOGGING')) {
          setIsLogging(prev => {
            const next = !prev;
            addLog(next ? 'Started logging' : 'Stopped logging', 'INFO');
            return next;
          });
        }
        break;
      default:
        await sendCommandWithAck(cmd, displayName);
    }
  };

  // MODIFIED: Simplified calibration handler - single step
  const handleCalibrate = () => {
    if (!calibrationValue || isNaN(Number(calibrationValue))) {
      addLog('Invalid calibration value', 'ERROR');
      return;
    }
    
    // Send calibration value directly
    const cmd = `CAL ${calibrationValue.trim()}`; // Space between CAL and value
    void sendCommandWithAck(cmd, `CALIBRATION_${calibrationValue}g`);
    addLog(`Setting calibration to ${calibrationValue}g`, 'INFO');
    
    // Note: calibrationPending is still managed but we don't use it for two-step anymore
    // You can remove it entirely if you want, but keeping for minimal changes
  };

  const handleReset = () => {
    if (confirm("Are you sure you want to reset the entire interface? Data history will be cleared.")) {
      addLog('System reset initiated', 'WARNING');
      setIsLogging(false);
      setTelemetryHistory([]);
      setMaxThrust(0);
      setMaxPressure(0);
      setMaxTemperatures(Array(11).fill(0));
      setCurrentFrame(null); 
      setPendingCommand(null);
      pendingCommandRef.current = null;
      setCalibrationPending(false); // Reset calibration state
      
      serviceRef.current?.disconnect();
      initService(useSimulator);
      
      setResetKey(prev => prev + 1);
      setConnectionStatus(ConnectionStatus.DISCONNECTED);
      addLog('System reset completed', 'INFO');
    }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setLogoSrc(e.target.result as string);
          setLogoError(false);
          addLog(`Logo updated: ${file.name}`, 'INFO');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Update ControlPanel props to include systemState
  const isArmDisabled = systemState !== SystemState.SYSTEM_IDLE || pendingCommand === 'ARM';
  const isDisarmDisabled = systemState !== SystemState.SYSTEM_ARMED || pendingCommand === 'DAR';
  const isIgnitionDisabled = systemState !== SystemState.SYSTEM_ARMED || pendingCommand === 'FIR';

  // Get status display text
  const getSystemStateDisplay = () => {
    switch(systemState) {
      case SystemState.SYSTEM_SAFE:
        return { text: 'SAFE', color: 'text-green-500', bg: 'bg-green-900/30' };
      case SystemState.SYSTEM_IDLE:
        return { text: 'IDLE', color: 'text-blue-500', bg: 'bg-blue-900/30' };
      case SystemState.SYSTEM_ARMED:
        return { text: 'ARMED', color: 'text-yellow-500', bg: 'bg-yellow-900/30' };
      case SystemState.SYSTEM_IGNITION:
        return { text: 'IGNITION', color: 'text-orange-500', bg: 'bg-orange-900/30' };
      case SystemState.SYSTEM_POST_IGNITION:
        return { text: 'POST-IGNITION', color: 'text-red-500', bg: 'bg-red-900/30' };
      default:
        return { text: 'UNKNOWN', color: 'text-gray-500', bg: 'bg-gray-900/30' };
    }
  };

  const stateDisplay = getSystemStateDisplay();

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white selection:text-black flex flex-col">
      
      {/* Top Bar */}
      <header className="h-20 border-b border-white/20 bg-black fixed top-0 w-full z-20 px-6 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          
          {/* Hidden File Input for Logo Upload */}
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleLogoUpload} 
          />

          {/* Logo Section */}
          <div 
            className="h-14 w-auto min-w-[3.5rem] bg-white rounded p-1 flex items-center justify-center overflow-hidden relative cursor-pointer hover:opacity-80 transition-opacity group"
            onClick={() => fileInputRef.current?.click()}
            title="Click to upload custom logo"
          >
             {!logoError ? (
               <img 
                  src={logoSrc} 
                  alt="Logo" 
                  className="object-contain h-full w-full" 
                  onError={() => {
                    if (logoSrc === 'logo.jpg') setLogoSrc('logo.png');
                    else if (logoSrc === 'logo.png') setLogoSrc('logo.JPG');
                    else setLogoError(true);
                  }}
               />
             ) : (
               <>
                 <Rocket className="text-black w-8 h-8 group-hover:hidden" />
                 <span className="hidden group-hover:block text-[8px] text-black font-bold text-center leading-tight">CHANGE LOGO</span>
               </>
             )}
          </div>
          
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tight text-white font-mono uppercase">
              Static Fire Monitor
            </h1>
            
            {/* System State Display */}
            <div className="flex items-center gap-2 mt-1">
              <div className={`px-2 py-0.5 rounded text-xs font-bold ${stateDisplay.bg} ${stateDisplay.color}`}>
                {stateDisplay.text}
              </div>
              
              {systemStatus === SystemStatus.ERROR && (
                <div className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                  SYSTEM ERROR
                </div>
              )}
            </div>

            <span className="text-xs font-bold text-zinc-500 tracking-[0.2em] uppercase mt-1">
              Rocketry Club IIT Tirupati
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          
          {/* RTC Clock */}
          <div className="flex items-center gap-2 text-zinc-400 hidden md:flex">
             <Clock className="w-4 h-4" />
             <span className="font-mono text-lg">{currentTime}</span>
          </div>

          {/* Mission Clock */}
          <div className="flex flex-col items-end border-r border-white/20 pr-6 mr-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Mission Clock</span>
            <span className={`font-mono text-3xl font-bold ${currentFrame?.status === MotorState.FIRING ? 'text-white animate-pulse' : 'text-zinc-300'}`}>
              {currentFrame?.timeMs ? `T+${(currentFrame.timeMs / 1000).toFixed(2)}` : 'T-00.00'}
            </span>
          </div>
          
          {/* Test Name Input */}
          <div className="flex flex-col items-end mr-2">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Test Name</span>
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                className="bg-transparent border-b border-zinc-700 text-white font-mono text-sm w-32 focus:outline-none focus:border-white transition-colors text-right"
                placeholder="TEST_ID"
              />
              <button
                onClick={handleSendTimestamp}
                disabled={connectionStatus !== ConnectionStatus.CONNECTED}
                className="bg-zinc-800 hover:bg-zinc-700 text-xs px-2 py-1 rounded text-zinc-300 disabled:opacity-50 border border-white/10 font-bold"
                title="Send Timestamp"
              >
                TIM
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-zinc-900 p-1.5 rounded-lg border border-white/10">
            
            {/* IP Input */}
            <div className="flex flex-col px-2">
                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Target IP</span>
                <input 
                type="text" 
                value={ipAddress}
                onChange={(e) => {
                  setIpAddress(e.target.value);
                  addLog(`IP changed to: ${e.target.value}`, 'INFO');
                }}
                disabled={connectionStatus !== ConnectionStatus.DISCONNECTED}
                className="bg-transparent border-none text-white font-mono text-sm w-28 focus:outline-none p-0 disabled:opacity-50"
                placeholder="192.168.1.50"
                />
            </div>

            {/* Mode Toggle */}
            <button
                onClick={toggleMode}
                disabled={connectionStatus !== ConnectionStatus.DISCONNECTED}
                className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${
                    useSimulator 
                    ? 'bg-blue-900/30 text-blue-400 border border-blue-800' 
                    : 'bg-orange-900/30 text-orange-400 border border-orange-800'
                } disabled:opacity-50`}
                title="Toggle between Simulation and Real Hardware"
            >
                {useSimulator ? <Cpu className="w-4 h-4"/> : <Zap className="w-4 h-4" />}
                <span className="text-xs font-bold">{useSimulator ? 'SIM' : 'LIVE'}</span>
            </button>

            {/* Connect Button */}
            <button 
                onClick={connectionStatus === ConnectionStatus.CONNECTED ? handleDisconnect : handleConnect}
                className={`w-28 px-4 py-2 rounded font-bold text-sm transition-all ${
                connectionStatus === ConnectionStatus.CONNECTED 
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-[0_0_10px_rgba(220,38,38,0.5)]'
                : 'bg-white hover:bg-zinc-200 text-black'
                }`}
            >
                {connectionStatus === ConnectionStatus.CONNECTED ? 'DISCONNECT' : connectionStatus === ConnectionStatus.CONNECTING ? '...' : 'LINK'}
            </button>
          </div>

        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="pt-24 p-4 flex-grow grid grid-cols-12 gap-4" style={{ height: 'calc(100vh - 6rem)' }}>
        {/* Left Sidebar: Controls */}
        <div className="col-span-12 lg:col-span-3 flex flex-col h-full overflow-hidden">
          <ControlPanel 
            status={currentFrame?.status || MotorState.IDLE}
            systemState={systemState}
            isArmDisabled={isArmDisabled}
            isDisarmDisabled={isDisarmDisabled}
            isIgnitionDisabled={isIgnitionDisabled}
            onSendCommand={handleSendCommand}
            isLogging={isLogging}
            onToggleLogging={() => handleSendCommand('SLG', 'TOGGLE_LOGGING')}
            isConnected={connectionStatus === ConnectionStatus.CONNECTED}
            onReset={handleReset}
            calibrationValue={calibrationValue}
            onCalibrationValueChange={setCalibrationValue}
            onCalibrate={handleCalibrate}
            pendingCommand={pendingCommand}
            calibrationPending={calibrationPending}
          />
        </div>

        {/* Main Content Area */}
        <div className="col-span-12 lg:col-span-9 flex flex-col gap-4 h-full overflow-hidden">
          
          {/* Top Section: Motor Visual (Expanded) */}
          <div className="flex-[5] min-h-0 rounded-lg overflow-hidden border border-white/20 relative">
            <MotorVisual 
              key={resetKey}
              telemetry={currentFrame} 
              maxTemperatures={maxTemperatures}
              maxThrust={maxThrust}
              maxPressure={maxPressure}
            />
          </div>

          {/* Bottom Section: Charts & Logs - FIXED HEIGHT */}
          <div className="flex-[4] min-h-0 flex gap-4 overflow-hidden">
            {/* Thrust Chart - FIXED */}
            <div className="flex-[3] border border-white/20 rounded-lg overflow-hidden min-h-0">
              <ThrustChart data={telemetryHistory} />
            </div>
            
            {/* Event Log */}
            <div className="flex-1 flex flex-col bg-black border border-white/20 rounded-lg overflow-hidden min-w-[250px] min-h-0">
              <div className="bg-zinc-900 px-3 py-2 border-b border-white/10 flex items-center gap-2">
                <Terminal className="w-3 h-3 text-white" />
                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Event Log</span>
                {pendingCommand && (
                  <div className="text-[9px] text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded animate-pulse">
                    Waiting ACK...
                  </div>
                )}
                <span className="ml-auto text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                  {logs.length} entries
                </span>
              </div>
              <div className="flex-grow p-3 overflow-y-auto font-mono text-[10px] space-y-1.5 bg-black">
                {logs.length === 0 && <span className="text-zinc-700 italic">System Ready. Connect to start receiving telemetry.</span>}
                {logs.map((log, idx) => (
                  <div key={idx} className="flex flex-col border-b border-zinc-900 pb-1 last:border-b-0">
                    <span className="text-zinc-600 text-[9px]">{log.timestamp}</span>
                    <span className={
                      log.type === 'ERROR' ? 'text-red-500 font-bold' : 
                      log.type === 'WARNING' ? 'text-yellow-400' : 
                      'text-zinc-300'
                    }>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;