// One band of the 4-layer structure (Access → Automation → Memory → Execution).
export default function Layer({ n, label, color, title, description, features = [], children, connector = true }) {
  return (
    <div data-c={color} className="layer-wrap">
      <section data-c={color} className="layer fade-in" aria-labelledby={`layer-${n}`}>
        <div className="grid grid-cols-1 lg:grid-cols-[150px_1fr]">
          <aside className="layer-rail flex items-center justify-center gap-4 border-b p-4 lg:flex-col lg:border-b-0 lg:border-r lg:p-5">
            <div className="layer-num" aria-hidden="true">{n}</div>
            <div className="layer-label">{label[0]}<br className="hidden lg:block" /> {label[1]}</div>
          </aside>
          <div className="min-w-0 p-4 sm:p-6">
            <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-xl">
                <h2 id={`layer-${n}`} className="layer-title">{title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-white/65">{description}</p>
              </div>
              {features.length > 0 && (
                <ul className="grid shrink-0 grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                  {features.map(({ icon: Icon, label: l, value }) => (
                    <li key={l} className="layer-feature flex items-center gap-2.5 text-[13.5px]">
                      <Icon size={17} strokeWidth={1.8} />
                      <span className="font-medium">{l}</span>
                      {value !== undefined && value !== null && <span className="truncate text-white/50">· {value}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </header>
            {children}
          </div>
        </div>
      </section>
      {connector && <div data-c={color} className="layer-connector" aria-hidden="true" />}
    </div>
  );
}
