declare const useSearch: (searchParams: URLSearchParams) => [Search & { hasSearchAddons: boolean }, (range: { start: number, end: number }) => void];
export = useSearch;
