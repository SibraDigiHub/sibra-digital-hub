import { LegalRoute, legalPageMetadata } from '@/components/real/legal-route'

export const metadata = legalPageMetadata('refund-policy')

export default function RefundPolicyPage() {
  return <LegalRoute page="refund-policy" />
}
