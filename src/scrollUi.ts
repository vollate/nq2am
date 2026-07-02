export function shouldShowGoTopButton(scrollY: number, threshold = 360): boolean {
  return scrollY >= threshold;
}
