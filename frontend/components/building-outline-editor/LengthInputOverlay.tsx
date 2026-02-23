'use client';

import { useState, useEffect, useRef } from 'react';
import { Point } from '@/lib/geometry/types';

interface LengthInputOverlayProps {
  /** Position where the input should appear (near the line midpoint) */
  position: Point;
  /** Current length value in meters */
  length: number;
  /** Callback when length is confirmed */
  onConfirm: (length: number) => void;
  /** Callback when input is cancelled */
  onCancel: () => void;
  /** Whether the input is visible */
  visible: boolean;
}

export function LengthInputOverlay({
  position,
  length,
  onConfirm,
  onCancel,
  visible,
}: LengthInputOverlayProps) {
  const [inputValue, setInputValue] = useState<string>(length.toFixed(2));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [visible]);

  useEffect(() => {
    setInputValue(length.toFixed(2));
  }, [length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numValue = parseFloat(inputValue);
    if (!isNaN(numValue) && numValue > 0) {
      onConfirm(numValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="absolute bg-white border-2 border-blue-500 rounded shadow-lg p-2 z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Length (m):
        </label>
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0.01"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSubmit}
          className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </form>
    </div>
  );
}
