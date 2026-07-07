import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'subtle';
export type ButtonSize = 'default' | 'compact';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  danger?: boolean;
  active?: boolean;
  pill?: boolean;
};

export function Button({ variant = 'default', size = 'default', danger = false, active = false, pill = false, className = '', type = 'button', ...props }: ButtonProps) {
  const classes = [
    'ui-button',
    variant === 'primary' ? 'primary' : '',
    variant === 'subtle' ? 'subtle-button' : '',
    size === 'compact' ? 'ui-button--compact' : '',
    danger ? 'danger' : '',
    active ? 'active' : '',
    pill ? 'rounded-button' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...props} />;
}
