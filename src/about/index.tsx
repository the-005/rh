import styles from "./style.module.css";

/**
 * About: the third view, and the only one that is words rather than pictures.
 * Same paper as the index — white, DM Sans, the frame's difference blend reading
 * black over it — so gallery → index → about is one material change, not three.
 *
 * Everything below is placeholder copy standing in for the real text. Swap the
 * statement, the contact lines and the lists; the layout does not depend on
 * their length.
 */

const CLIENTS = [
  "Aperture",
  "Another Magazine",
  "Studio Nomad",
  "Kinfolk",
  "The Gentlewoman",
  "Nike",
  "Hermès",
  "Wallpaper*",
];

const SERVICES = ["Editorial", "Portraiture", "Campaign", "Still life", "Art direction"];

export function AboutPage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.statement}>
          <h1 className={styles.heading}>About</h1>

          <p className={styles.lede}>
            A photographer working between editorial and commercial commissions, with a practice built
            around long looks at ordinary things — rooms after everyone has left them, light doing the
            same work twice, people caught a beat before or after the picture they expected.
          </p>

          <p className={styles.body}>
            The work moves between film and digital without much ceremony about either. Most of it starts
            as a walk and ends as a sequence: a project is finished when the images stop needing each
            other's company to make sense. Recent series have been made in Lisbon, Osaka and the length of
            the A9 in the Scottish Highlands.
          </p>

          <p className={styles.body}>
            Available for commissions worldwide. Prints from every series are made to order in editions of
            twelve; enquiries about licensing, exhibitions and workshops are all welcome at the address
            below.
          </p>
        </div>

        <aside className={styles.details}>
          <section className={styles.block}>
            <h2 className={styles.label}>Contact</h2>
            <ul className={styles.lines}>
              <li>
                <a className={styles.link} href="mailto:studio@example.com">
                  studio@example.com
                </a>
              </li>
              <li>
                <a className={styles.link} href="tel:+15550100">
                  +1 555 0100
                </a>
              </li>
              <li>
                <a className={styles.link} href="https://instagram.com" target="_blank" rel="noreferrer">
                  Instagram
                </a>
              </li>
            </ul>
          </section>

          <section className={styles.block}>
            <h2 className={styles.label}>Studio</h2>
            <ul className={styles.lines}>
              <li>Unit 4, Warehouse Lane</li>
              <li>Brooklyn, NY 11222</li>
              <li>By appointment</li>
            </ul>
          </section>

          <section className={styles.block}>
            <h2 className={styles.label}>Services</h2>
            <ul className={styles.lines}>
              {SERVICES.map((service) => (
                <li key={service}>{service}</li>
              ))}
            </ul>
          </section>

          <section className={styles.block}>
            <h2 className={styles.label}>Selected clients</h2>
            <ul className={styles.lines}>
              {CLIENTS.map((client) => (
                <li key={client}>{client}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
