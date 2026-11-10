const router = { push() {}, replace() {}, prefetch() {} };
export const useRouter = () => router;
export const useSearchParams = () => new URLSearchParams(window.location.search);
