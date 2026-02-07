'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function PointsPage() {
  const params = useParams();
  const teamId = params.id;
  const router = useRouter();

  useEffect(() => {
    // Redirect to the main team page since points are now shown there
    router.replace(`/teams/${teamId}`);
  }, [teamId, router]);

  return (
    <div className="text-center py-12">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      <p className="mt-4 text-gray-600">Redirecting to team page...</p>
    </div>
  );
}
