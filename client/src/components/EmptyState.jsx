import React from 'react';

export default function EmptyState({ icon = '📊', title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-300 mb-2">{title}</h3>
      <p className="text-sm text-slate-500 text-center max-w-md mb-6">{description}</p>
      {action}
    </div>
  );
}
