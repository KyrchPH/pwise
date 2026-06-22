import { useEffect, useRef } from 'react';

// Lightweight wrapper around lottie-web. `lottie-web` is loaded on demand so it
// stays out of the initial bundle (same approach as the Wise Assistant overlay).
// Pass an imported animation JSON as `animationData`.
export default function LottiePlayer({
  animationData,
  loop = true,
  autoplay = true,
  className = '',
  style,
}) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current || !animationData) return undefined;

    let live = true;
    let animation = null;

    import('lottie-web')
      .then((module) => {
        if (!live || !hostRef.current) return;
        animation = module.default.loadAnimation({
          container: hostRef.current,
          renderer: 'svg',
          loop,
          autoplay,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
      })
      .catch((error) => {
        console.error('Failed to load lottie animation.', error);
      });

    return () => {
      live = false;
      animation?.destroy();
    };
  }, [animationData, loop, autoplay]);

  return <div ref={hostRef} className={className} style={style} aria-hidden="true" />;
}
