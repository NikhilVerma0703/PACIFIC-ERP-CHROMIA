// Toast notification system is implemented in lib/toast-context.tsx
// ToastProvider wraps the page in app/consumables/page.tsx
// Use the hook anywhere: const { showToast } = useToast()
// showToast("Message", "success" | "error" | "info" | "warning")

export { useToast, ToastProvider } from "@/components/consumables/toast-context";
