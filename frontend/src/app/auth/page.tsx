import type { Metadata } from 'next';

import { AuthShell } from './auth-shell';

export const metadata: Metadata = {
  title: 'Welcome',
  description: 'Create an account or sign in to EVORA.',
};

export default function AuthPage() {
  return <AuthShell />;
}
