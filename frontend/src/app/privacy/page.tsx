import { LegalRoute, legalPageMetadata } from '@/components/real/legal-route'

export const metadata = legalPageMetadata('privacy')

export default function PrivacyPage() {
  return <LegalRoute page="privacy" />
}
