# mlops/src/train.py

import joblib
import mlflow
import mlflow.sklearn
import pandas as pd
from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score


def main():
    # --------------------------------------------------
    # Paths
    # --------------------------------------------------
    DATA_PATH = Path("data/processed/telco_clean.csv")
    MODEL_PATH = Path("model.pkl")

    # --------------------------------------------------
    # MLflow configuration (CI-safe)
    # --------------------------------------------------
    mlflow.set_tracking_uri("file:./mlruns")
    mlflow.set_experiment("smartbag-tp2-telco")

    # --------------------------------------------------
    # Load processed dataset
    # --------------------------------------------------
    df = pd.read_csv(DATA_PATH)

    if "churn" not in df.columns:
        raise ValueError("Target column 'churn' not found in processed dataset")

    X = df.drop(columns=["churn"])
    y = df["churn"]

    # --------------------------------------------------
    # Train / test split
    # --------------------------------------------------
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y
    )

    # --------------------------------------------------
    # Model definition
    # --------------------------------------------------
    n_estimators = 400
    max_depth = 20

    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=42,
        n_jobs=-1
    )

    # --------------------------------------------------
    # Training + MLflow logging
    # --------------------------------------------------
    with mlflow.start_run():
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)

        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred)
        recall = recall_score(y_test, y_pred)

        # Log parameters
        mlflow.log_param("model_type", "RandomForestClassifier")
        mlflow.log_param("n_estimators", n_estimators)
        mlflow.log_param("max_depth", max_depth)

        # Log metrics
        mlflow.log_metric("accuracy", accuracy)
        mlflow.log_metric("precision", precision)
        mlflow.log_metric("recall", recall)

        # Log model (MLflow)
        mlflow.sklearn.log_model(model, name="model")

        # Save model artifact for DVC
        joblib.dump(model, MODEL_PATH)

        print("Training completed successfully")
        print(f"Accuracy : {accuracy:.4f}")
        print(f"Precision: {precision:.4f}")
        print(f"Recall   : {recall:.4f}")


if __name__ == "__main__":
    main()
