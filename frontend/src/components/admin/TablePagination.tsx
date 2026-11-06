import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Rows per page in the admin tables (customers, orders, products). */
export const TABLE_PAGE_SIZE = 12

interface TablePaginationProps {
  /** Current 1-based page (already clamped to pageCount). */
  page: number
  pageCount: number
  /** Total rows across all pages. */
  total: number
  onPageChange: (page: number) => void
  /** Entity name for the aria labels, e.g. "customers". */
  label: string
}

/**
 * Shared admin table pagination footer. Rendered by the caller only
 * when the list spans more than one page, so small tables look
 * exactly as before.
 */
export default function TablePagination({ page, pageCount, total, onPageChange, label }: TablePaginationProps) {
  return (
    <nav
      aria-label={`${label} pagination`}
      className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3"
    >
      <p className="text-xs text-[#9AA89E]">
        Page <span className="font-mono text-[#F5F8F6]">{page}</span> of{' '}
        <span className="font-mono text-[#F5F8F6]">{pageCount}</span> · {total} {label}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-white/15 bg-transparent text-[#F5F8F6] hover:bg-white/5"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={`Previous ${label} page`}
        >
          <ChevronLeft className="size-4" aria-hidden="true" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-white/15 bg-transparent text-[#F5F8F6] hover:bg-white/5"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label={`Next ${label} page`}
        >
          Next <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
