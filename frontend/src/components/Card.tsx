import { type ElementType, type ReactNode, useId } from 'react';
import styles from './Card.module.css';

export type CardProps = {
  /** A heading for the card. It also names the card for screen readers when `as` is "section". */
  title?: string;
  /** The heading level. Use the level that follows the page's headings (2 under the page title). */
  headingLevel?: 2 | 3 | 4;
  /** Buttons or links shown opposite the title. */
  actions?: ReactNode;
  /** `none` lets a table or list reach the card's edges. */
  padding?: 'md' | 'lg' | 'none';
  as?: 'section' | 'div' | 'article';
  children: ReactNode;
};

/** A white panel with a thin border, the design's container for a group of related content. */
export function Card({ title, headingLevel = 2, actions, padding = 'md', as = 'section', children }: CardProps) {
  const titleId = useId();
  const Root: ElementType = as;
  const Heading: ElementType = `h${headingLevel}`;
  return (
    <Root className={styles.card} data-padding={padding} aria-labelledby={title && as === 'section' ? titleId : undefined}>
      {(title || actions) && (
        <div className={styles.header}>
          {title && (
            <Heading id={titleId} className={styles.title}>
              {title}
            </Heading>
          )}
          {actions}
        </div>
      )}
      {children}
    </Root>
  );
}
