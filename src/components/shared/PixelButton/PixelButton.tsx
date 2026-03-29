/**
 * Reusable button component with 2px border
 */

import type { ButtonHTMLAttributes } from 'react';
import './PixelButton.css';

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary';
}

export function PixelButton({ variant = 'default', className = '', ...props }: PixelButtonProps) {
  const classes = `pixel-button ${variant === 'primary' ? 'primary' : ''} ${className}`.trim();
  return <button className={classes} {...props} />;
}