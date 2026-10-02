import React from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import HeroBanner from '../components/HeroBanner';

/**
 * The association's existing resident portal, run by Taylor Management on
 * Enumerate Engage. Documents, payments, the calendar and the directory all
 * still live there and are maintained there -- these links hand residents
 * straight to them rather than this site keeping a second, staler copy.
 *
 * Only paths confirmed from the portal itself are listed. Adding a guessed one
 * would give residents a dead link, which is worse than a missing one.
 */
const PORTAL = 'https://engage.goenumerate.com/s/townsquarevillage';

// Most residents reach this page on a phone, so the number is a tel: link
// everywhere it appears -- tappable rather than something to write down. Held
// in one place so the office card, the emergency notice and the footer can
// never drift apart.
const OFFICE_PHONE = '973-328-4015';
const OFFICE_PHONE_HREF = 'tel:+19733284015';

const PORTAL_LINKS = [
  { label: 'News & Events', href: `${PORTAL}/communityfeed.php` },
  { label: 'Documents & Payments', href: `${PORTAL}/myhoaresources.php` },
  { label: 'Community Pages', href: `${PORTAL}/publichoa.php` },
  { label: 'Resident Portal', href: `${PORTAL}/home.php` },
  { label: 'Resources', href: `${PORTAL}/myhoaresources.php` },
];

/**
 * The public front door. Everything else in the app is behind a login, so this
 * is the only page a resident sees before they have an account -- it has to say
 * who the association is and give them one obvious thing to do.
 *
 * The hero is a drawn banner rather than a photograph, so it stays sharp at
 * any width and sits at its own size instead of being stretched to fill.
 */
export default function Home() {
  const { user } = useAuth();

  return (
    <div className="home">
      <header className="home-bar">
        <nav className="home-bar-inner" aria-label="Main">
          <div className="home-links">
            {PORTAL_LINKS.map((link) => (
              <a
                key={link.label}
                className="home-link-out"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
                <span className="home-out" aria-hidden="true">&#8599;</span>
              </a>
            ))}
          </div>

          <div className="home-actions">
            {user ? (
              <Link to="/dashboard" className="home-btn home-btn-primary">My requests</Link>
            ) : (
              <>
                <Link to="/login" className="home-btn home-btn-primary">Sign in</Link>
                <Link to="/register" className="home-link">Create an account</Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <div className="home-hero">
        <HeroBanner />
      </div>

      <main className="home-main">
        <div className="home-grid">
          <section className="home-welcome">
            <h1 className="home-welcome-title">Welcome to Townsquare Village HOA, Inc.</h1>
            <p>
              Townsquare Village HOA, Inc. is dedicated to ensuring the beauty, safety and
              stability of the area, promoting neighborliness and pride among the residents,
              and forming a base for representation in matters affecting the community.
            </p>
            <p>
              This site provides services to residents of Townsquare Village HOA, Inc.,
              located in Rockaway, New Jersey.
            </p>

            <div className="home-cta">
              <h3>Report an issue or violation to management</h3>
              <p>
                Report a problem with the grounds, a shared space or the community rules.
                You will see its status and every update along the way, right through to
                closing. Repairs inside your own home stay with the homeowner.
              </p>
              {/* Filing a request needs an account, so a signed-out visitor is
                  offered the two ways to have one rather than a button leading
                  somewhere they cannot yet go. */}
              {user ? (
                <div className="home-cta-actions">
                  <Link to="/tickets/new" className="home-btn home-btn-primary home-btn-lg">
                    Submit a request
                  </Link>
                  <Link to="/dashboard" className="home-btn home-btn-quiet home-btn-lg">
                    My requests
                  </Link>
                </div>
              ) : (
                <div className="home-cta-actions">
                  <Link to="/login" className="home-btn home-btn-primary home-btn-lg">
                    Sign in
                  </Link>
                  <Link to="/register" className="home-btn home-btn-quiet home-btn-lg">
                    Create an account
                  </Link>
                </div>
              )}
            </div>

            {/* The steps follow the call to action they explain, which also
                takes up the run of empty column the sidebar used to leave. */}
            <ol className="home-steps home-steps-inline">
              <li>
                <strong>Submit your request</strong> with a category and location.
              </li>
              <li>
                <strong>Management picks it up</strong> and starts work.
              </li>
              <li>
                <strong>You can comment</strong>, and you see every status change.
              </li>
              <li>
                <strong>It closes</strong> when the work is done.
              </li>
            </ol>
          </section>

          <aside className="home-aside">
            <div className="home-card">
              <h3>Association office</h3>
              <p className="home-card-strong">Townsquare Village HOA, Inc.</p>
              <p>
                129 Pondview Terrace
                <br />
                Rockaway, New Jersey 07866
              </p>
              <p>
                <a className="home-phone" href={OFFICE_PHONE_HREF}>{OFFICE_PHONE}</a>
                <br />
                <a href="mailto:office@townsquarevillagenj.com">
                  office@townsquarevillagenj.com
                </a>
              </p>
            </div>

            <div className="home-card">
              <h3>Association resources</h3>
              <ul className="home-reslist">
                <li>
                  <a href={`${PORTAL}/myhoaresources.php`} target="_blank" rel="noopener noreferrer">
                    Documents &amp; Governing Rules
                  </a>
                </li>
                <li>
                  <a href={`${PORTAL}/myhoaresources.php`} target="_blank" rel="noopener noreferrer">
                    Make a Payment
                  </a>
                </li>
                <li>
                  <a href={`${PORTAL}/communityfeed.php`} target="_blank" rel="noopener noreferrer">
                    Board Meetings &amp; News
                  </a>
                </li>
                <li>
                  <a href={`${PORTAL}/communityfeed.php`} target="_blank" rel="noopener noreferrer">
                    Calendar &amp; Committees
                  </a>
                </li>
                <li>
                  <a href={`${PORTAL}/publichoa.php`} target="_blank" rel="noopener noreferrer">
                    Community Pages
                  </a>
                </li>
              </ul>
              <p className="home-reslist-note">
                Hosted on the association&rsquo;s resident portal, managed by Taylor Management.
              </p>
            </div>

          </aside>
        </div>
      </main>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <span>Townsquare Village HOA, Inc. &middot; Rockaway, New Jersey</span>
          <span>
            <a href={OFFICE_PHONE_HREF}>{OFFICE_PHONE}</a>
            {' · '}
            <a href="mailto:office@townsquarevillagenj.com">office@townsquarevillagenj.com</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
