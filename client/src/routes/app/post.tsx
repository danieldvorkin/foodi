import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { social } from '../../api/types';
import { PostCard } from '../../components/PostCard';

export async function postLoader({ params }: LoaderFunctionArgs) {
  return social.post(params['id']!);
}

/** One post with its whole thread open. The card does all the work. */
export function PostPage() {
  const { post, comments } = useLoaderData<typeof postLoader>();
  const nav = useNavigate();
  return (
    <main className="page-narrow stack-lg feed">
      <Link to="/app" className="muted small">
        ← Feed
      </Link>
      <PostCard post={post} detail comments={comments} onDeleted={() => nav('/app')} />
      {!post.commentsEnabled && <p className="muted small">🥘 This is a house recipe from the foodi kitchen — comments are off, but you can like it, save a copy, adapt it, or add it to one of your books from the recipe page.</p>}
    </main>
  );
}
