import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'neutral' | 'highlight' | 'danger';
export type ButtonSize = 'md' | 'sm';

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string) {
  return [styles.button, styles[variant], size === 'sm' && styles.sm, extra].filter(Boolean).join(' ');
}

type Common = {
  /** `primary` is the main action on a screen; use one per view. `highlight` is the next step. */
  variant?: ButtonVariant;
  /** `md` is 44px, the touch-target minimum. `sm` (36px) is for dense rows only. */
  size?: ButtonSize;
  /** A decorative icon before the label (hidden from screen readers; the label names the button). */
  icon?: ReactNode;
};

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={classes(variant, size, className)}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

export type ButtonLinkProps = Common & Omit<LinkProps, 'className'> & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'>;

/** A link that looks like a button, for navigating (a button is for doing something on the page). */
export function ButtonLink({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={classes(variant, size, className)}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </Link>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  /** What the button does ("Remove Alex Wilber"). Required: an icon alone has no name. */
  label: string;
  children: ReactNode;
};

/** A button with only an icon. Its `label` is its accessible name and its tooltip. */
export function IconButton({ label, children, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} title={label} className={[styles.iconButton, className].filter(Boolean).join(' ')}>
      <span className={styles.icon} aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
