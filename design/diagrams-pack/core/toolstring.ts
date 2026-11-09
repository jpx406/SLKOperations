// The one type the diagrams borrow from the host app's older toolstring list. Keep it if your app has no such list:
// legacyToolstring() in diagram.ts returns this shape for apps that keep a simple toolstring on the job.
export interface ToolPart { component: string; od_in?: number | null; length_ft?: number | null; weight_lb?: number | null }
