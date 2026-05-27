import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type UiActionButtonVariant = 'default' | 'positive' | 'secondary' | 'danger';

type UiActionButtonCommonProps = {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  variant?: UiActionButtonVariant;
};

type UiActionButtonAsButtonProps = UiActionButtonCommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: never;
  };

type UiActionButtonAsLinkProps = UiActionButtonCommonProps &
  Omit<LinkProps, 'children' | 'className'> & {
    disabled?: boolean;
  };

type UiActionButtonProps = UiActionButtonAsButtonProps | UiActionButtonAsLinkProps;

function buildClassName({
  className,
  compact,
  variant = 'default',
}: {
  className?: string | undefined;
  compact?: boolean | undefined;
  variant?: UiActionButtonVariant | undefined;
}) {
  return [
    'ui-action-button',
    variant !== 'default' ? `ui-action-button--${variant}` : '',
    compact ? 'ui-action-button--compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function renderContent(children: ReactNode, icon?: ReactNode, iconPosition: 'left' | 'right' = 'left') {
  if (!icon) {
    return children;
  }

  return iconPosition === 'right' ? (
    <>
      <span>{children}</span>
      {icon}
    </>
  ) : (
    <>
      {icon}
      <span>{children}</span>
    </>
  );
}

export function UiActionButton(props: UiActionButtonProps) {
  const {
    children,
    className,
    compact,
    icon,
    iconPosition,
    variant,
  } = props;
  const composedClassName = buildClassName({ className, compact, variant });

  if ('to' in props && props.to !== undefined) {
    const {
      children: _children,
      className: _className,
      compact: _compact,
      disabled,
      icon: _icon,
      iconPosition: _iconPosition,
      onClick,
      to,
      variant: _variant,
      ...linkProps
    } = props;

    return (
      <Link
        {...linkProps}
        to={to}
        className={composedClassName}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : linkProps.tabIndex}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }

          onClick?.(event);
        }}
      >
        {renderContent(children, icon, iconPosition)}
      </Link>
    );
  }

  const {
    children: _children,
    className: _className,
    compact: _compact,
    icon: _icon,
    iconPosition: _iconPosition,
    type = 'button',
    variant: _variant,
    ...buttonProps
  } = props;

  return (
    <button {...buttonProps} type={type} className={composedClassName}>
      {renderContent(children, icon, iconPosition)}
    </button>
  );
}
