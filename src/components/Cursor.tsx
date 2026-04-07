import React from "react";

interface CursorProps {
  color: string;
  name: string;
  x: number;
  y: number;
  zoom?: number;
  onClick?: () => void;
}

export default function Cursor({ color, name, x, y, zoom = 1, onClick }: CursorProps) {
  return (
    <div
      className="absolute top-0 left-0 pointer-events-none z-[100] flex flex-col items-start transition-transform duration-75 ease-linear will-change-transform"
      style={{ transform: `translate(${x}px, ${y}px) scale(${1 / zoom})`, transformOrigin: 'top left' }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-md"
      >
        <path
          d="M5.65376 21.1598L19.3953 14.5385C20.658 13.9298 20.8016 12.1868 19.6543 11.3789L3.79185 0.208119C2.65681 -0.590514 1.10091 0.40487 1.34114 1.77796L4.17933 17.9942C4.38202 19.1534 5.75961 19.5857 6.64366 18.775L9.36262 16.2828L13.8821 24.3797C14.4988 25.4851 15.914 25.881 17.0163 25.2631C18.1187 24.6453 18.5146 23.2301 17.8979 22.1247L13.374 14.0305L16.0353 11.5903C16.899 10.7984 15.5358 10.3609 14.6517 11.1716L5.65376 21.1598Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>
      <div
        onClick={onClick}
        className={`px-2 py-1 bg-neutral-900 text-white rounded-md text-xs font-medium whitespace-nowrap shadow-md ml-4 mt-1 ${onClick ? 'cursor-pointer pointer-events-auto hover:scale-105 active:scale-95 transition-transform' : ''}`}
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  );
}
