import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  preventCloseOnOverlayClick?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  preventCloseOnOverlayClick = false,
}: ModalProps) {
  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return createPortal(
    <>
      {/* Backdrop overlay */}
      <div
        onClick={() => {
          if (!preventCloseOnOverlayClick) onClose();
        }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"
      ></div>

      {/* Modal container */}
      <div
        className={clsx(
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200",
          maxWidthClasses[maxWidth]
        )}
      >
        <div className="flex justify-between items-start gap-4">
          <div className="space-y-1">
            <h3 className="font-extrabold text-lg text-white leading-tight">{title}</h3>
            {description && (
              <p className="text-xs text-neutral-400 font-light">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-neutral-400 hover:text-white transition-colors flex-shrink-0"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">{children}</div>
      </div>
    </>,
    document.body
  );
}
