import { AlertTriangle, Info, CheckCircle2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string | undefined;
  cancelText?: string | undefined;
  type?: 'danger' | 'warning' | 'info' | 'success' | undefined;
  isLoading?: boolean | undefined;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmationDialog({
  isOpen,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'info',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!isOpen) return null;

  // Visual variants for icons and buttons based on type
  const typeConfigs = {
    danger: {
      icon: AlertTriangle,
      iconClass: 'text-red-400 bg-red-500/10 border border-red-500/20',
      confirmBtnClass: 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20',
    },
    warning: {
      icon: AlertTriangle,
      iconClass: 'text-amber-400 bg-amber-500/10 border border-amber-500/20',
      confirmBtnClass: 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20',
    },
    info: {
      icon: Info,
      iconClass: 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20',
      confirmBtnClass: 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20',
    },
    success: {
      icon: CheckCircle2,
      iconClass: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20',
      confirmBtnClass: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20',
    },
  };

  const config = typeConfigs[type] || typeConfigs.info;
  const IconComponent = config.icon;

  return createPortal(
    <>
      {/* Backdrop overlay */}
      <div 
        onClick={() => { if (!isLoading) onCancel(); }} 
        className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[9999] transition-opacity duration-300"
      ></div>

      {/* Dialog container */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center space-y-4">
          {/* Icon Circle */}
          <div className={clsx("p-3 rounded-2xl flex items-center justify-center", config.iconClass)}>
            <IconComponent className="w-6 h-6" />
          </div>

          {/* Text Contents */}
          <div className="space-y-1.5">
            <h3 className="font-extrabold text-base text-white">{title}</h3>
            <p className="text-xs text-neutral-400 leading-relaxed font-light px-2">
              {description}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 text-xs font-bold">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="flex-1 py-3 bg-white/5 border border-white/5 hover:bg-white/10 text-neutral-400 hover:text-white rounded-xl transition-all disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={clsx(
              "flex-1 py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-50",
              config.confirmBtnClass
            )}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
