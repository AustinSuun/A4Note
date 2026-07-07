import type { HTMLAttributes, ReactNode } from 'react';

export type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
};

export function Panel({ title, description, children, className = '', ...props }: PanelProps) {
  const classes = ['soft-panel', className].filter(Boolean).join(' ');

  return (
    <section className={classes} {...props}>
      {title ? <div className="panel-title">{title}</div> : null}
      {description ? <p className="ui-panel-description">{description}</p> : null}
      {children}
    </section>
  );
}
