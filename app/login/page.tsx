import { SignInButton } from "@/components/auth/sign-in-button";

export default function LoginPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Sign in to TravelChat</h1>
        <p className="mt-2 text-sm text-gray-400">Save your conversations and pick up where you left off.</p>
      </div>
      <SignInButton />
    </div>
  );
}
