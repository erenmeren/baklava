import Link from "next/link";

export default function Home() {
  return (
    <main>
      Baklava
      <h1>Home</h1>
      <Link href="/about">About</Link>
    </main>
  );
}
