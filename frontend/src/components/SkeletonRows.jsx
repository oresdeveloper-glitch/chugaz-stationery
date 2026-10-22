// Shimmer rows shown while a list is first loading, so the page feels alive
// instead of flashing an empty table. Purely presentational.
export default function SkeletonRows({ rows = 5 }) {
  return (
    <div className="skel-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skel-row${i % 3 === 2 ? ' short' : ''}`} />
      ))}
    </div>
  );
}
