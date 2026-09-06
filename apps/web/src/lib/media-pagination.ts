export function clampMediaPage(currentPage: number, totalCount: number, pageSize: number): number {
	const safePageSize = Math.max(1, Math.floor(pageSize));
	const lastPage = Math.max(0, Math.ceil(Math.max(0, totalCount) / safePageSize) - 1);
	return Math.min(Math.max(0, Math.floor(currentPage)), lastPage);
}
