import { redirect } from 'next/navigation';

// Docs live under /docs; the root sends visitors straight to the Overview.
export default function HomePage() {
  redirect('/docs');
}
