const router = { push(href: string) { window.history.pushState(null, '', href); }, replace(href: string) { window.history.replaceState(null, '', href); }, prefetch() {} };
export const useRouter = () => router;
export const useSearchParams = () => new URLSearchParams(window.location.search);
