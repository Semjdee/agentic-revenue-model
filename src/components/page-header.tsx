export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 md:px-8 pt-6 pb-4 flex-wrap">
      <div>
        <h1 className="text-[19px] font-semibold text-ink-primary tracking-tight">{title}</h1>
        {description && <p className="text-[13px] text-ink-secondary mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
