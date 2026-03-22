import React, { useState, useRef, useEffect } from 'react';
import { TelemetryFrame, SensorConfig, TemperatureSensor } from '../types';
import { Lock, LockOpen } from 'lucide-react';

interface MotorVisualProps {
  telemetry: TelemetryFrame | null;
  maxTemperatures: number[];
  maxThrust: number;
  maxPressure: number;
}

// Updated: 5 top (T1-T5), 5 bottom (T6-T10), 1 extra (T11)
const INITIAL_SENSORS: SensorConfig[] = [
    // Top Row - 5 sensors
    { id: 0, x: 20, y: 30, label: 'T1' },
    { id: 1, x: 35, y: 30, label: 'T2' },
    { id: 2, x: 50, y: 30, label: 'T3' },
    { id: 3, x: 65, y: 30, label: 'T4' },
    { id: 4, x: 80, y: 30, label: 'T5' },
    // Bottom Row - 5 sensors
    { id: 5, x: 20, y: 70, label: 'T6' },
    { id: 6, x: 35, y: 70, label: 'T7' },
    { id: 7, x: 50, y: 70, label: 'T8' },
    { id: 8, x: 65, y: 70, label: 'T9' },
    { id: 9, x: 80, y: 70, label: 'T10' },
    // Extra sensor - T11 placed on the side
    { id: 10, x: 90, y: 50, label: 'T11' },
];

const MotorVisual: React.FC<MotorVisualProps> = ({ 
    telemetry, 
    maxTemperatures,
    maxThrust,
    maxPressure 
}) => {
  const [sensors, setSensors] = useState<SensorConfig[]>(INITIAL_SENSORS);
  const [isLocked, setIsLocked] = useState(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Helper to get temp for a sensor ID
  const getTempSensor = (id: number): TemperatureSensor | null => {
    if (!telemetry || !telemetry.temperatures) {
      // No data yet → NOT an error
      return null;
    }

    const raw = telemetry.temperatures[id];

    // Backward compatibility: old simulator sends number
    if (typeof raw === 'number') {
      return { value: raw, status: 'WORKING' };
    }

    return raw ?? null;
  };

  const getTempColor = (sensor: TemperatureSensor | null) => {
    if (!sensor || sensor.status === 'ERROR') return '#6b7280'; // gray (error)

    const temp = sensor.value;
    if (temp < 40) return '#10b981';   // green
    if (temp < 80) return '#facc15';   // yellow
    if (temp < 150) return '#f97316';  // orange
    return '#ef4444';                  // red
  };

  const handleMouseDown = (e: React.MouseEvent, id: number) => {
    if (isLocked) return;
    setDraggingId(id);
    e.stopPropagation();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingId === null || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));

    setSensors(prev => prev.map(s => 
      s.id === draggingId ? { ...s, x, y } : s
    ));
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-black overflow-hidden relative">
      
      {/* Top Telemetry Dashboard (Integrated High-Vis Metrics) */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4 bg-zinc-900/50 border-b border-white/10 z-10 shrink-0">
         <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Instant Thrust</span>
            <div className="text-2xl font-mono font-bold text-white flex items-baseline gap-2 truncate">
                {telemetry?.thrust.toFixed(0) || '0'} <span className="text-sm text-zinc-600 font-normal">N</span>
            </div>
         </div>
         <div className="flex flex-col border-l border-white/5 pl-4 min-w-0">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Peak Thrust</span>
            <div className="text-2xl font-mono font-bold text-zinc-400 flex items-baseline gap-2 truncate">
                {maxThrust.toFixed(0)} <span className="text-sm text-zinc-700 font-normal">N</span>
            </div>
         </div>
         <div className="flex flex-col border-l border-white/5 pl-4 min-w-0">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Chamber Pressure</span>
            <div className="text-2xl font-mono font-bold text-white flex items-baseline gap-2 truncate">
                {telemetry?.chamberPressure.toFixed(0) || '0'} <span className="text-sm text-zinc-600 font-normal">PSI</span>
            </div>
         </div>
         <div className="flex flex-col border-l border-white/5 pl-4 min-w-0">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Peak Pressure</span>
            <div className="text-2xl font-mono font-bold text-zinc-400 flex items-baseline gap-2 truncate">
                {maxPressure.toFixed(0)} <span className="text-sm text-zinc-700 font-normal">PSI</span>
            </div>
         </div>
      </div>

      {/* Toolbar */}
      <div className="absolute top-[80px] left-4 z-10 flex flex-col">
        {!isLocked && <span className="text-[10px] bg-white text-black px-2 py-0.5 rounded font-bold mb-1 w-max">EDIT MODE</span>}
        <button 
            onClick={() => setIsLocked(!isLocked)}
            className={`p-1.5 rounded bg-black/50 border border-white/10 hover:bg-zinc-800 transition-colors w-max ${isLocked ? 'text-zinc-600' : 'text-white'}`}
            title={isLocked ? "Unlock to move sensors" : "Lock positions"}
        >
            {isLocked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
        </button>
      </div>

      {/* Visual Container */}
      <div 
        ref={containerRef}
        className="relative flex-grow w-full bg-black cursor-crosshair overflow-hidden"
        onMouseMove={handleMouseMove}
      >
        {/* SVG Background Layer */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             {/* Extended ViewBox for longer motor appearance */}
             <svg 
                viewBox="0 0 800 200" 
                className="w-full h-full drop-shadow-2xl" 
                preserveAspectRatio="xMidYMid meet"
             >
                <defs>
                    <linearGradient id="motorBodyBW" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1a1a1a" />
                        <stop offset="50%" stopColor="#2a2a2a" />
                        <stop offset="100%" stopColor="#1a1a1a" />
                    </linearGradient>
                    <linearGradient id="fireGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="1" />
                        <stop offset="50%" stopColor="#ef4444" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                    </linearGradient>
                </defs>
                
                {/* Motor Body - Elongated */}
                <rect x="100" y="60" width="500" height="80" rx="2" fill="url(#motorBodyBW)" stroke="#444" strokeWidth="2" />
                
                {/* Fore Cap */}
                <path d="M 100 60 Q 60 100 100 140 Z" fill="#111" stroke="#444" strokeWidth="2" />
                
                {/* Nozzle Assembly */}
                <path d="M 600 70 L 650 50 L 650 150 L 600 130 Z" fill="#111" stroke="#444" strokeWidth="2" />
                
                {/* Colored Exhaust Plume */}
                {telemetry && telemetry.thrust > 10 && (
                    <path 
                        d="M 650 60 Q 750 100 650 140" 
                        fill="none" 
                        stroke="url(#fireGradient)" 
                        strokeWidth="6" 
                        className="animate-pulse opacity-90"
                        strokeDasharray="10 5"
                        strokeLinecap="round"
                    >
                         <animate attributeName="stroke-dashoffset" from="100" to="0" dur="0.1s" repeatCount="indefinite" />
                         <animate attributeName="stroke-width" values="4;7;4" dur="0.2s" repeatCount="indefinite" />
                    </path>
                )}
             </svg>
        </div>

        {/* Grid Lines (only in edit mode) */}
        {!isLocked && (
            <div className="absolute inset-0 pointer-events-none" 
                 style={{backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '20px 20px', opacity: 0.5}}>
            </div>
        )}

        {/* Draggable Sensors */}
        {sensors.map((sensor) => {
          const tempSensor = getTempSensor(sensor.id);
          const maxTemp = maxTemperatures[sensor.id] || 0;
          const color = getTempColor(tempSensor);

          return (
            <div
              key={sensor.id}
              onMouseDown={(e) => handleMouseDown(e, sensor.id)}
              className={`absolute transform -translate-x-1/2 -translate-y-1/2 group select-none transition-shadow z-20
                ${isLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
              `}
              style={{ left: `${sensor.x}%`, top: `${sensor.y}%` }}
            >
              {/* Connection Line */}
              {!isLocked && (
                 <div className="absolute top-1/2 left-1/2 w-0 h-0 border border-white/20 rounded-full group-hover:w-32 group-hover:h-32 transition-all -translate-x-1/2 -translate-y-1/2 -z-10" />
              )}

              {/* Sensor Node */}
              <div className="relative">
                <div 
                    className="absolute inset-0 rounded-full blur-md opacity-30 transition-colors duration-500"
                    style={{ backgroundColor: color, transform: 'scale(1.5)' }} 
                />
                
                <div 
                    className={`w-4 h-4 rounded-full border-2 shadow-sm flex items-center justify-center text-[8px] font-bold bg-black transition-colors duration-300 z-10`}
                    style={{ borderColor: color, color: color }}
                >
                    {/* Show T11 for the 11th sensor, otherwise show number */}
                    {sensor.id === 10 ? '11' : sensor.id + 1}
                </div>

                {/* Data Tag */}
                <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-black/90 border border-zinc-700 rounded px-2 py-1 whitespace-nowrap z-30 pointer-events-none shadow-xl flex flex-col items-center">
                    <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-0.5">
                        T{sensor.id === 10 ? 11 : sensor.id + 1}
                    </div>
                    <div className="flex gap-2 text-[10px] font-mono items-center">
                        {!tempSensor ? (
                          // No data yet (before LINK)
                          <span className="text-zinc-500 font-bold">--</span>
                        ) : tempSensor.status === 'WORKING' ? (
                          // Normal sensor
                          <span className="text-white font-bold">
                            {tempSensor.value.toFixed(1)}°
                          </span>
                        ) : (
                          // Explicit sensor error
                          <span className="text-red-500 font-bold">
                            ERROR
                           </span>
                        )}

                        {tempSensor?.status === 'WORKING' && (
                          <span className="text-zinc-600 text-[8px] border-l border-zinc-800 pl-2">
                            MAX {maxTemp.toFixed(1)}°
                          </span>
                        )}
                    </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Legend */}
        <div className="absolute bottom-2 right-2 bg-black/80 border border-zinc-800 p-2 rounded text-[9px] font-mono text-zinc-500 flex gap-4">
            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></div> Safe</div>
            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#facc15]"></div> Warm</div>
            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#f97316]"></div> Hot</div>
            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#ef4444]"></div> Critical</div>
        </div>

      </div>
    </div>
  );
};

export default MotorVisual;