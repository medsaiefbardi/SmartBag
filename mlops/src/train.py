# mlops/src/train.py
import os
import joblib
import mlflow
import mlflow.sklearn

from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score


def main():
    # --------------------------------------------------
    # Force MLflow to use a local directory (CI-safe)
    # --------------------------------------------------
    mlflow.set_tracking_uri("file:./mlruns")
    mlflow.set_experiment("smartbag-mlops")

    # --------------------------------------------------
    # Load dataset
    # --------------------------------------------------
    data = load_iris()
    X = data.data
    y = data.target

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    # --------------------------------------------------
    # Train model
    # --------------------------------------------------
    n_estimators = 100
    model = RandomForestClassifier(
        n_estimators=n_estimators,
        random_state=42
    )

    with mlflow.start_run():
        model.fit(X_train, y_train)

        predictions = model.predict(X_test)
        accuracy = accuracy_score(y_test, predictions)

        # Log metrics & params
        mlflow.log_param("n_estimators", n_estimators)
        mlflow.log_metric("accuracy", accuracy)

        # Log model (CI-safe)
        mlflow.sklearn.log_model(model, name="model")

        # Save model artifact for DVC
        joblib.dump(model, "model.pkl")

        print(f"Accuracy: {accuracy}")


if __name__ == "__main__":
    main()
