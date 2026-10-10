import React from 'react';

interface ToastProps {
  message: string | null;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm bg-[#1a1c19] text-white px-4 py-3 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-slide-down border border-[#3f4942]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="material-symbols-outlined text-[#a4f3c5] text-[20px] shrink-0">
          check_circle
        </span>
        <span className="text-xs font-medium leading-snug">{message}</span>
      </div>
      <button
        onClick={onClose}
        className="text-[#bfc9c0] hover:text-white shrink-0 p-1"
        aria-label="Dismiss toast"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
};
