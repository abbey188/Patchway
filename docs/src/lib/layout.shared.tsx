import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/patchway-logo.svg"
          alt="Patchway"
          style={{ height: '48px', width: 'auto' }}
        />
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'Console',
        url: 'https://console.patchway.xyz',
        external: true,
      },
    ],
  };
}
