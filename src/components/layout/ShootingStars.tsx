import classNames from "classnames";
import styles from "./ShootingStars.module.scss";

const n = 20;

export function ShootingStars() {
  return (
    <div className="absolute size-full overflow-hidden">
      {[...new Array(n).keys()].map((i) => (
        <div
          key={i}
          className={classNames(styles.shooting_star, "rotate-45")}
        />
      ))}
    </div>
  );
}
