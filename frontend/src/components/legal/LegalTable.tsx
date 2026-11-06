'use client'

// ═══════════════════════════════════════════════════════════
// Responsive legal table: real <table> from md up (with th
// scope), stacked labelled cards on phones.
// ═══════════════════════════════════════════════════════════

interface Props {
  columns: [string, ...string[]]
  rows: string[][]
}

export default function LegalTable({ columns, rows }: Props) {
  return (
    <>
      {/* Desktop: real table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-[rgba(229,184,66,0.25)] md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-[#E5B842]/10">
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="px-4 py-3 font-bold text-[#FAE8A7]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-white/10 align-top">
                {row.map((cell, ci) => (
                  <td
                    key={`${row[0]}-${ci}`}
                    scope={ci === 0 ? 'row' : undefined}
                    className={
                      ci === 0
                        ? 'px-4 py-3 font-semibold text-[#F5F8F6]'
                        : 'px-4 py-3 text-[#C7D0C9]'
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked labelled cards */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={row[0]} className="glass rounded-2xl px-4 py-4">
            <p className="text-sm font-bold text-[#FAE8A7]">{row[0]}</p>
            {columns.slice(1).map((col, i) => (
              <p key={col} className="mt-2">
                <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-[#E5B842]">
                  {col}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-[#C7D0C9]">
                  {row[i + 1]}
                </span>
              </p>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
