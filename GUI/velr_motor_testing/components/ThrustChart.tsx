import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TelemetryFrame } from '../types';

interface ThrustChartProps {
  data: TelemetryFrame[];
}

const ThrustChart: React.FC<ThrustChartProps> = ({ data }) => {
  // Transform data to use timeMs (convert milliseconds to seconds for display)
  const chartData = data.map(frame => ({
    ...frame,
    displayTime: frame.timeMs ? frame.timeMs / 1000 : (frame.missionTime || 0) // Convert ms to seconds
  }));

  return (
    <div className="w-full h-full bg-black rounded-lg border border-white/20 p-4 flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-white text-sm font-bold uppercase tracking-wider">Thrust Curve</h3>
        <span className="text-xs text-zinc-500 font-mono">N (Newtons) vs Time</span>
      </div>
      <div className="flex-grow min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorThrust" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ffffff" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis 
              dataKey="displayTime" 
              tick={{fill: '#888', fontSize: 10, fontFamily: 'monospace'}}
              tickFormatter={(val) => val.toFixed(1)}
              interval="preserveStartEnd"
              minTickGap={30}
              label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#888' }}
            />
            <YAxis 
              tick={{fill: '#888', fontSize: 10, fontFamily: 'monospace'}} 
              domain={[0, 'auto']}
              width={40}
              label={{ value: 'Thrust (N)', angle: -90, position: 'insideLeft', fill: '#888' }}
            />
            <Tooltip 
              contentStyle={{backgroundColor: '#000000', borderColor: '#ffffff', color: '#ffffff'}}
              itemStyle={{color: '#ffffff'}}
              labelStyle={{color: '#888888', fontFamily: 'monospace'}}
              formatter={(value: number) => [`${value.toFixed(0)} N`, 'Thrust']}
              labelFormatter={(label) => `T+${Number(label).toFixed(2)}s`}
            />
            <Area 
              type="monotone" 
              dataKey="thrust" 
              stroke="#ffffff" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorThrust)" 
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ThrustChart;