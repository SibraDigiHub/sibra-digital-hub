import { LegalRoute, legalPageMetadata } from '@/components/real/legal-route'

export const metadata = legalPageMetadata('terms')

export default function TermsPage() {
  return <LegalRoute page="terms" />
}
