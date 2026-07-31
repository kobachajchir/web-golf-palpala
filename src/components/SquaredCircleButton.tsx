import type { ButtonHTMLAttributes, ReactNode } from 'react';

type SquaredCircleButtonVariant = 'primary' | 'secondary' | 'danger' | 'positive';

type SquaredCircleButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
  variant?: SquaredCircleButtonVariant;
};

export function SquaredCircleButton({
  children,
  className,
  label,
  title,
  type = 'button',
  variant = 'primary',
  ...buttonProps
}: SquaredCircleButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      className={[
        'squared-circle-button',
        `squared-circle-button--${variant}`,
        className ?? '',
      ].filter(Boolean).join(' ')}
      aria-label={label}
      title={title ?? label}
    >
      {children}
    </button>
  );
}
