import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button {...props} type={type} className={`button button--${variant} ${className}`} />;
}
