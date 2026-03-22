import React from 'react';
import { MotorState, SystemState } from '../types';
import { ShieldAlert, Flame, Power, Save, RotateCcw, Shield, Target, Zap } from 'lucide-react';

interface ControlPanelProps {
  status: MotorState;
  systemState: SystemState;
  isArmDisabled: boolean;
  isDisarmDisabled: boolean;
  isIgnitionDisabled: boolean;
  onSendCommand: (cmd: string, displayName: string) => void;
  isLogging: boolean;
  onToggleLogging: () => void;
  isConnected: boolean;
  onReset: () => void;
  calibrationValue: string;
  onCalibrationValueChange: (value: string) => void;
  onCalibrate: () => void;
  pendingCommand?: string | null;
  calibrationPending: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  status, 
  systemState,
  isArmDisabled,
  isDisarmDisabled,
  isIgnitionDisabled,
  onSendCommand, 
  isLogging, 
  onToggleLogging,
  isConnected,
  onReset,
  calibrationValue,
  onCalibrationValueChange,
  onCalibrate,
  pendingCommand,
  calibrationPending
}) => {
  const isArmed = status === MotorState.ARMED;

  // NEW: Handle direct calibration send
  const handleCalibrationSend = () => {
    if (!calibrationValue.trim()) {
      alert('Please enter a calibration value');
      return;
    }
    
    // Send the CAL command with the entered value directly
    const command = `CAL ${calibrationValue.trim()}`;
    onSendCommand(command, `CAL ${calibrationValue.trim()}`);
    
    // Optional: Clear the input after sending
    // onCalibrationValueChange('');
  };

  return (
    <div className="bg-black border border-white/20 rounded-lg p-6 flex flex-col gap-6 h-full overflow-y-auto">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4 flex-shrink-0">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Power className="w-5 h-5 text-white" />
          Controls
        </h2>
        <div className={`px-2 py-1 rounded text-xs font-bold border ${isConnected ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800'}`}>
          {isConnected ? 'LINK ACTIVE' : 'NO LINK'}
        </div>
      </div>

      {/* Sequence Controls */}
      <div className="space-y-4 flex-grow">
        
        {/* Arm/Disarm Buttons */}
        <div className="grid grid-cols-2 gap-4">
          {/* ARM Button */}
          <button
            onClick={() => onSendCommand('ARM', 'ARM')}
            disabled={!isConnected || isArmDisabled}
            className={`h-24 rounded border-2 font-bold transition-all flex flex-col items-center justify-center gap-2 relative
              ${isArmDisabled 
                ? 'bg-zinc-900/50 border-zinc-800 text-zinc-600 cursor-not-allowed' 
                : 'bg-black border-zinc-700 hover:border-green-500 hover:text-green-400 text-zinc-400'
              } ${pendingCommand === 'ARM' ? 'animate-pulse border-green-500' : ''}`}
            title={isArmDisabled ? "System must be in IDLE state to ARM" : "Arm the system"}
          >
            {pendingCommand === 'ARM' && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-yellow-500 rounded-full animate-ping"></div>
            )}
            <ShieldAlert className={`w-6 h-6 ${pendingCommand === 'ARM' ? 'text-yellow-400' : ''}`} />
            ARM
            {pendingCommand === 'ARM' && (
              <div className="text-[8px] text-yellow-500 font-mono mt-1">WAITING ACK</div>
            )}
          </button>

          {/* DISARM Button */}
          <button
            onClick={() => onSendCommand('DAR', 'DISARM')}
            disabled={!isConnected || isDisarmDisabled}
            className={`h-24 rounded border-2 font-bold transition-all flex flex-col items-center justify-center gap-2 relative
              ${isDisarmDisabled
                ? 'bg-zinc-900/50 border-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-black border-zinc-700 hover:border-red-500 hover:text-red-400 text-zinc-400'
              } ${pendingCommand === 'DAR' ? 'animate-pulse border-red-500' : ''}`}
            title={isDisarmDisabled ? "System must be ARMED to DISARM" : "Disarm the system"}
          >
            {pendingCommand === 'DAR' && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-yellow-500 rounded-full animate-ping"></div>
            )}
            <Shield className={`w-6 h-6 ${pendingCommand === 'DAR' ? 'text-yellow-400' : ''}`} />
            DISARM
            {pendingCommand === 'DAR' && (
              <div className="text-[8px] text-yellow-500 font-mono mt-1">WAITING ACK</div>
            )}
          </button>
        </div>

        {/* Status Indicators */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-zinc-500">
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            {isConnected ? 'TELNET CONN' : 'NO CONN'}
          </div>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${systemState === SystemState.SYSTEM_IDLE ? 'bg-blue-500' : 'bg-zinc-700'}`}></div>
            CONTROL VOLTAGE
          </div>
        </div>

        {/* Fire Button - Big and Red */}
        <button
          onClick={() => onSendCommand('FIR', 'IGNITION')}
          disabled={!isConnected || isIgnitionDisabled}
          className={`w-full p-8 rounded-lg border-2 font-black text-2xl tracking-widest transition-all shadow-lg flex items-center justify-center gap-4 relative
            ${isIgnitionDisabled
              ? 'bg-zinc-900 border-zinc-800 text-zinc-700 cursor-not-allowed' 
              : 'bg-red-900/30 border-red-700 text-white hover:bg-red-900/50 hover:border-red-500 hover:animate-pulse'
            } ${pendingCommand === 'FIR' ? 'animate-pulse border-red-500' : ''}`}
        >
          {pendingCommand === 'FIR' && (
            <div className="absolute top-3 right-3 w-3 h-3 bg-yellow-500 rounded-full animate-ping"></div>
          )}
          <Flame className={`w-8 h-8 ${pendingCommand === 'FIR' ? 'text-yellow-400' : ''}`} />
          IGNITION
          {pendingCommand === 'FIR' && (
            <div className="absolute bottom-2 text-[10px] text-yellow-500 font-mono">WAITING ACK</div>
          )}
        </button>

        {/* Calibration Section - MODIFIED for direct send */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <h3 className="text-xs font-bold text-zinc-400 uppercase mb-2 flex items-center gap-1">
            <Target className="w-3 h-3" />
            Load Cell Calibration
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={calibrationValue}
              onChange={(e) => onCalibrationValueChange(e.target.value)}
              className={`flex-1 bg-zinc-900 border rounded px-3 py-2 text-sm text-white font-mono transition-colors ${
                pendingCommand?.startsWith('CAL')
                  ? 'border-purple-500 animate-pulse'
                  : 'border-white/20 placeholder:text-zinc-500'
              }`}
              placeholder="Enter calibration value (g)"
              disabled={!isConnected || pendingCommand?.startsWith('CAL')}
            />
            <button
              onClick={handleCalibrationSend}  // CHANGED: Use new handler
              disabled={!isConnected || !calibrationValue.trim() || pendingCommand?.startsWith('CAL')}
              className={`px-4 py-2 rounded font-medium text-sm flex items-center gap-1 transition-all ${
                pendingCommand?.startsWith('CAL')
                  ? 'bg-purple-800 text-purple-300 animate-pulse'
                  : !calibrationValue.trim()
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-700 text-white border border-white/20'
              }`}
              title="Send calibration value"
            >
              {pendingCommand?.startsWith('CAL') ? (
                <>
                  <Zap className="w-3 h-3 animate-spin" />
                  SENDING...
                </>
              ) : (
                'SEND CAL'
              )}
            </button>
          </div>
          <div className="text-[9px] mt-1 text-zinc-500">
            Enter calibration value in grams and click SEND CAL
          </div>
        </div>

      </div>

      {/* Bottom Controls - Fixed at bottom */}
      <div className="pt-4 border-t border-zinc-800 space-y-3 flex-shrink-0">
        
        {/* Logging Button */}
        <button
          onClick={onToggleLogging}
          disabled={!isConnected}
          className={`w-full p-3 rounded font-semibold flex items-center justify-center gap-2 transition-colors border relative
            ${isLogging 
              ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300 hover:border-emerald-500' 
              : 'bg-black border-zinc-700 text-zinc-300 hover:border-white'
            } disabled:opacity-50 ${pendingCommand === 'SLG' ? 'animate-pulse border-yellow-500' : ''}`}
        >
          {pendingCommand === 'SLG' && (
            <div className="absolute top-2 right-2 w-2 h-2 bg-yellow-500 rounded-full animate-ping"></div>
          )}
          <Save className={`w-4 h-4 ${pendingCommand === 'SLG' ? 'text-yellow-400' : ''}`} />
          {isLogging ? 'STOP LOGGING' : 'START LOGGING'}
          {pendingCommand === 'SLG' && (
            <span className="ml-2 text-[8px] text-yellow-500 font-mono">WAITING ACK</span>
          )}
        </button>

        {/* Reset Button */}
        <button
            onClick={onReset}
            className="w-full p-2 rounded text-xs font-mono text-zinc-500 hover:text-white hover:bg-zinc-900 flex items-center justify-center gap-2 border border-transparent hover:border-zinc-700 transition-all"
        >
            <RotateCcw className="w-3 h-3" />
            RESET INTERFACE & SYSTEM
        </button>

      </div>

    </div>
  );
};

export default ControlPanel;