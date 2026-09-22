#[tokio::main]
async fn main() {
    if let Err(err) = papernet_student::run().await {
        eprintln!("papernet-student: {err}");
        std::process::exit(1);
    }
}
