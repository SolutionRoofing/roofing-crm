import type { ReactNode } from 'react';
import { Logo, Tagline } from './logo';

type Company = { company?: string | null; phone?: string | null; address?: string | null };

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Header for customer-facing pages: logo on cream, phone number in orange (brand guide). */
export function PublicBar({ company, children }: { company: Company; children?: ReactNode }) {
  return (
    <div className="public-bar no-print">
      <Logo height={72} />
      <div className="bar-end">
        {company.phone && <a className="public-phone" href={telHref(company.phone)}>{company.phone}</a>}
        {children}
      </div>
    </div>
  );
}

/** Footer for customer-facing pages: tagline plus the contact block. */
export function PublicFoot({ company }: { company: Company }) {
  return (
    <footer className="public-foot no-print">
      <Tagline />
      <p className="eyebrow">
        {[company.company || 'Solution Roofing', company.address, 'solutionroof.com'].filter(Boolean).join(' · ')}
      </p>
    </footer>
  );
}
