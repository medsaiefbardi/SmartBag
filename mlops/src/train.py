import pandas as pd
import joblib
import mlflow
import mlflow.sklearn

from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score

def main():
    mlflow.set_experiment("smartbag-mlops")

    data = load_iris()
    X = data.data
    y = data.target

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    n_estimators = 100
    model = RandomForestClassifier(n_estimators=n_estimators, random_state=42)

    with mlflow.start_run():
        model.fit(X_train, y_train)

        preds = model.predict(X_test)
        acc = accuracy_score(y_test, preds)

        mlflow.log_param("n_estimators", n_estimators)
        mlflow.log_metric("accuracy", acc)
        mlflow.sklearn.log_model(model, "model")

        joblib.dump(model, "model.pkl")

        print(f"Accuracy: {acc}")

if __name__ == "__main__":
    main()