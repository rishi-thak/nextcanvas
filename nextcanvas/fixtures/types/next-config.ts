import type { NextConfig } from 'next';
import withCanvasDefault, { withCanvas } from '@rishi-thak/nextcanvas/next';

// The standard next.config.ts annotation, also preserved by init.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { swcPlugins: [['existing-plugin', {}]] },
};
export default withCanvas(nextConfig);
const named: NextConfig = withCanvas(nextConfig);
const defaultImport: NextConfig = withCanvasDefault(nextConfig);
const empty: NextConfig = withCanvas();
const explicitUndefined: NextConfig = withCanvas(undefined);
declare const optionalConfig: NextConfig | undefined;
const optional: NextConfig = withCanvas(optionalConfig);
const inferred = withCanvas({ reactStrictMode: true } satisfies NextConfig);
const strictMode: boolean = inferred.reactStrictMode;

interface ExtendedConfig extends NextConfig { customSetting: string }
declare const extended: ExtendedConfig;
const preserved: string = withCanvas(extended).customSetting;

// Contextual typing still comes from Next's real config, including callbacks.
withCanvas({ webpack(config, { dev }) { const development: boolean = dev; return config; } });
// @ts-expect-error Next config values must retain their real types.
withCanvas({ reactStrictMode: 'yes' });
// @ts-expect-error The wrapper accepts config objects, not primitives.
withCanvas('config');
// @ts-expect-error Required extension fields cannot be invented by the no-arg call.
withCanvas<ExtendedConfig>();
